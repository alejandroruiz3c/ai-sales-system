-- 0010 · Reservas de gasto: el presupuesto corta antes de llamar (F2.5)
--
-- `app.cobrar_llamada` (0006) cobra un importe conocido de antemano, y eso le
-- basta a la llamada de prueba de F1, que cuesta 0,05 € fijos. Una llamada a un
-- modelo de verdad **no sabe lo que va a costar hasta que termina**: depende de
-- cuánto escriba el modelo y de si acierta en la caché. Cobrar después no
-- corta nada (la llamada ya se hizo), y cobrar una estimación antes apuntaría
-- en el libro una cifra que no es la real.
--
-- Por eso el router de `packages/llm` trabaja en dos pasos:
--
--   1. `app.autorizar_gasto` **reserva el coste máximo** posible de la llamada
--      (toda la entrada y toda la salida hasta `max_tokens`). Si lo gastado,
--      más lo reservado por otras llamadas en curso, más esta reserva no cabe
--      en el límite del mes, la llamada **no se hace**. Eso es cortar de
--      verdad: el presupuesto no se entera de que se ha pasado, lo impide;
--   2. `app.liquidar_gasto` libera la reserva y apunta **el coste real** en el
--      libro, con sus tokens de caché. Se llama siempre, también cuando el
--      proveedor falla (con coste cero), y cruza los umbrales del 50 %, 80 % y
--      100 % igual que `cobrar_llamada`.
--
-- La reserva caduca sola: si el proceso muere entre los dos pasos, la reserva
-- deja de contar a los 15 minutos (o a las 25 horas para un lote), en vez de
-- bloquear presupuesto para siempre.
--
-- Las dos funciones hacen `select … for update` sobre la fila del presupuesto
-- del mes, que es lo que serializa a dos funciones de Inngest del mismo tenant:
-- sin eso, veinte llamadas a la vez leerían el mismo gastado y ninguna vería el
-- corte. `security invoker`, como `cobrar_llamada`: el aislamiento lo aplica
-- RLS y reservar en el presupuesto de otro corporate no es cuestión de pasar su
-- uuid.

-- ── El libro de gasto, con la caché y el modo ────────────────────────────────
-- Sin los tokens de caché no se puede explicar por qué una llamada costó menos
-- que otra igual (T2.3), y sin el modo no se puede comprobar que el lote cuesta
-- la mitad (T2.4).

alter table public.spend_ledger
  add column tokens_cache_leidos   integer not null default 0 check (tokens_cache_leidos >= 0),
  add column tokens_cache_escritos integer not null default 0 check (tokens_cache_escritos >= 0),
  add column modo                  text not null default 'directo' check (modo in ('directo', 'lote'));

-- ── spend_reservations ───────────────────────────────────────────────────────

create table public.spend_reservations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  agente        text not null,
  importe_eur   numeric(12,6) not null check (importe_eur >= 0),
  referencia    text,
  caduca_en     timestamptz not null,
  liquidada_en  timestamptz,
  apunte_id     uuid references public.spend_ledger(id) on delete set null,
  creado_por    uuid references auth.users(id) on delete set null,
  creado_en     timestamptz not null default now(),
  constraint spend_reservations_caduca_despues check (caduca_en > creado_en)
);

-- Solo interesan las vivas: son las que cuentan contra el límite.
create index spend_reservations_vivas
  on public.spend_reservations (tenant_id, caduca_en)
  where liquidada_en is null;

alter table public.spend_reservations enable row level security;

create policy spend_reservations_lectura on public.spend_reservations
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy spend_reservations_insertar on public.spend_reservations
  for insert to authenticated
  with check (app.es_miembro(tenant_id));

create policy spend_reservations_liquidar on public.spend_reservations
  for update to authenticated
  using (app.es_miembro(tenant_id))
  with check (app.es_miembro(tenant_id));

-- Un usuario solo puede marcar una reserva como liquidada: ni cambiar su
-- importe ni alargar su caducidad. El `grant` por columnas lo impide antes de
-- que la política llegue a evaluarse.
grant select, insert on public.spend_reservations to authenticated;
grant update (liquidada_en, apunte_id) on public.spend_reservations to authenticated;

-- ── Lo reservado y vivo ──────────────────────────────────────────────────────

create or replace function app.reservado_vivo(p_tenant uuid)
returns numeric
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce(sum(r.importe_eur), 0)::numeric
  from public.spend_reservations r
  where r.tenant_id = p_tenant
    and r.liquidada_en is null
    and r.caduca_en > now()
$$;

-- ── Los umbrales, una sola vez ───────────────────────────────────────────────
-- Marca los avisos del 50 % y el 80 % y el corte del 100 % que el gasto real
-- del mes haya cruzado, y publica un único `budget.threshold.reached` con los
-- que se crucen ahora.
--
-- Es `security definer` por una razón concreta: marcar un aviso actualiza
-- `tenant_budgets`, y su política de escritura es solo para administradores.
-- Si esta función corriera con los privilegios de quien llama, un editor que
-- ejecuta un agente gastaría sin que se anotara ningún aviso. Y es segura de
-- conceder porque **no recibe el importe: lo calcula**. Llamarla a mano no
-- puede falsear nada, solo anotar lo que ya es verdad, y exige además ser
-- miembro del corporate (o el sistema).

create or replace function app.cruzar_umbrales(p_tenant uuid, p_mes date)
returns text[]
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_umbrales  text[] := array[]::text[];
  v_limite    numeric;
  v_gastado   numeric;
  v_avisado50 boolean;
  v_avisado80 boolean;
  v_cortado   boolean;
  v_sistema   boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  if not (v_sistema or app.es_miembro(p_tenant)) then
    raise exception 'Solo un miembro del corporate puede anotar sus umbrales de presupuesto'
      using errcode = '42501';
  end if;

  select limite_eur, avisado_50, avisado_80, cortado
    into v_limite, v_avisado50, v_avisado80, v_cortado
  from public.tenant_budgets
  where tenant_id = p_tenant and mes = p_mes;

  if not found or v_limite <= 0 then
    return v_umbrales;
  end if;

  v_gastado := app.gasto_del_mes(p_tenant, p_mes);

  if not v_avisado50 and v_gastado >= v_limite * 0.5 then
    update public.tenant_budgets set avisado_50 = true where tenant_id = p_tenant and mes = p_mes;
    v_umbrales := array_append(v_umbrales, '50');
  end if;
  if not v_avisado80 and v_gastado >= v_limite * 0.8 then
    update public.tenant_budgets set avisado_80 = true where tenant_id = p_tenant and mes = p_mes;
    v_umbrales := array_append(v_umbrales, '80');
  end if;
  if not v_cortado and v_gastado >= v_limite then
    update public.tenant_budgets set cortado = true where tenant_id = p_tenant and mes = p_mes;
    v_umbrales := array_append(v_umbrales, '100');
  end if;

  if array_length(v_umbrales, 1) is not null then
    perform app.registrar_evento(
      p_tenant, 'budget.threshold.reached',
      jsonb_build_object('umbrales', v_umbrales, 'limite_eur', v_limite, 'gastado_eur', v_gastado),
      'presupuesto', 'sistema'
    );
  end if;

  return v_umbrales;
end
$$;

-- ── Bloquear el presupuesto del mes ──────────────────────────────────────────
-- Un `select … for update` bajo RLS solo ve las filas que pasarían también la
-- política de **actualización**, y la de `tenant_budgets` es de administrador:
-- un editor que bloquea la fila no la ve, y para él «no hay presupuesto». Es un
-- fallo que traía `app.cobrar_llamada` desde F1.13 y que no se veía porque la
-- sala de pruebas cobra como sistema y los tests cobraban como propietaria.
--
-- El bloqueo se hace aquí, `security definer`, con la pertenencia comprobada a
-- mano. A quien no es miembro se le devuelve null, que es lo mismo que veía
-- antes: sin fila, sin presupuesto, sin reserva. El bloqueo pertenece a la
-- transacción, no a la función, así que sigue vigente al volver.

create or replace function app.bloquear_presupuesto(p_tenant uuid, p_mes date)
returns numeric
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_limite  numeric;
  v_sistema boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  if not (v_sistema or app.es_miembro(p_tenant)) then
    return null;
  end if;
  select limite_eur into v_limite
  from public.tenant_budgets
  where tenant_id = p_tenant and mes = p_mes
  for update;
  return v_limite;
end
$$;

-- ── `cobrar_llamada`, con el mismo bloqueo ───────────────────────────────────
-- Idéntica a la de 0006 salvo en cómo bloquea la fila del presupuesto. Es el
-- arreglo del fallo de F1.13 descrito en `app.bloquear_presupuesto`.

create or replace function app.cobrar_llamada(
  p_tenant         uuid,
  p_coste_eur      numeric,
  p_agente         text,
  p_concepto       text default 'llm',
  p_modelo         text default null,
  p_tokens_entrada integer default 0,
  p_tokens_salida  integer default 0,
  p_referencia     text default null,
  p_cache_acertada boolean default false
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_mes       date := date_trunc('month', now())::date;
  v_limite    numeric;
  v_antes     numeric;
  v_despues   numeric;
  v_cortado   boolean;
  v_avisado50 boolean;
  v_avisado80 boolean;
  v_umbrales  text[] := array[]::text[];
  v_ledger_id uuid;
begin
  if p_coste_eur is null or p_coste_eur < 0 then
    raise exception 'Un coste negativo no es un apunte' using errcode = '22023';
  end if;

  -- El `for update` serializa los cobros concurrentes del mismo tenant. Sin él,
  -- veinte llamadas a la vez leerían el mismo gasto y ninguna vería el corte.
  -- El bloqueo, con `app.bloquear_presupuesto`: un `for update` directo no ve la
  -- fila para quien no administra (ver arriba). Después, los avisos se leen con
  -- un `select` normal, que la política de lectura permite a cualquier miembro.
  v_limite := app.bloquear_presupuesto(p_tenant, v_mes);

  select cortado, avisado_50, avisado_80
    into v_cortado, v_avisado50, v_avisado80
  from public.tenant_budgets
  where tenant_id = p_tenant and mes = v_mes;

  if v_limite is null then
    return jsonb_build_object(
      'permitida', false,
      'motivo', 'sin_presupuesto',
      'mensaje', 'Este corporate no tiene presupuesto asignado para el mes en curso.',
      'limite_eur', 0,
      'gastado_eur', 0
    );
  end if;

  v_antes := app.gasto_del_mes(p_tenant, v_mes);

  -- Límite a cero y límite agotado son dos situaciones distintas para quien
  -- lo lee: una es «no lo has configurado» y la otra «te lo has gastado». El
  -- Copiloto tiene que poder decir cuál de las dos es (T2B.10).
  if v_limite = 0 then
    return jsonb_build_object(
      'permitida', false,
      'motivo', 'sin_presupuesto',
      'mensaje', 'Este corporate tiene el presupuesto del mes a 0 €. Asígnale uno en Ajustes → Presupuesto.',
      'limite_eur', 0,
      'gastado_eur', app.gasto_del_mes(p_tenant, v_mes)
    );
  end if;

  if v_antes >= v_limite then
    if not v_cortado then
      update public.tenant_budgets set cortado = true
      where tenant_id = p_tenant and mes = v_mes;
      perform app.registrar_evento(
        p_tenant, 'budget.threshold.reached',
        jsonb_build_object('umbral', 100, 'limite_eur', v_limite, 'gastado_eur', v_antes),
        'presupuesto', 'sistema'
      );
    end if;

    return jsonb_build_object(
      'permitida', false,
      'motivo', 'presupuesto_agotado',
      'mensaje', format(
        'Presupuesto del mes agotado: %s € de %s €. Amplíalo en Ajustes → Presupuesto para seguir.',
        to_char(v_antes, 'FM999999990.0000'), to_char(v_limite, 'FM999999990.0000')),
      'limite_eur', v_limite,
      'gastado_eur', v_antes
    );
  end if;

  insert into public.spend_ledger (
    tenant_id, agente, concepto, modelo,
    tokens_entrada, tokens_salida, coste_eur, cache_acertada, referencia, creado_por
  )
  values (
    p_tenant, p_agente, p_concepto, p_modelo,
    coalesce(p_tokens_entrada, 0), coalesce(p_tokens_salida, 0),
    p_coste_eur, coalesce(p_cache_acertada, false), p_referencia, (select auth.uid())
  )
  returning id into v_ledger_id;

  v_despues := v_antes + p_coste_eur;

  if not v_avisado50 and v_despues >= v_limite * 0.5 then
    update public.tenant_budgets set avisado_50 = true
    where tenant_id = p_tenant and mes = v_mes;
    -- `array_append` y no `||`: con un literal sin tipo, Postgres intenta
    -- interpretarlo como array y falla con «malformed array literal».
    v_umbrales := array_append(v_umbrales, '50');
  end if;

  if not v_avisado80 and v_despues >= v_limite * 0.8 then
    update public.tenant_budgets set avisado_80 = true
    where tenant_id = p_tenant and mes = v_mes;
    v_umbrales := array_append(v_umbrales, '80');
  end if;

  if not v_cortado and v_despues >= v_limite then
    update public.tenant_budgets set cortado = true
    where tenant_id = p_tenant and mes = v_mes;
    v_umbrales := array_append(v_umbrales, '100');
  end if;

  if array_length(v_umbrales, 1) is not null then
    perform app.registrar_evento(
      p_tenant, 'budget.threshold.reached',
      jsonb_build_object(
        'umbrales', v_umbrales,
        'limite_eur', v_limite,
        'gastado_eur', v_despues
      ),
      'presupuesto', 'sistema'
    );
  end if;

  return jsonb_build_object(
    'permitida', true,
    'motivo', 'ok',
    'apunte_id', v_ledger_id,
    'limite_eur', v_limite,
    'gastado_eur', v_despues,
    'porcentaje', case when v_limite > 0
                    then round((v_despues / v_limite) * 100, 2)
                    else null end,
    'umbrales_cruzados', to_jsonb(v_umbrales)
  );
end
$$;

-- ── Autorizar: reservar antes de llamar ──────────────────────────────────────

create or replace function app.autorizar_gasto(
  p_tenant           uuid,
  p_importe_eur      numeric,
  p_agente           text,
  p_referencia       text default null,
  p_validez_segundos integer default 900
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_mes       date := date_trunc('month', now())::date;
  v_limite    numeric;
  v_gastado   numeric;
  v_reservado numeric;
  v_libre     numeric;
  v_reserva   uuid;
begin
  if p_importe_eur is null or p_importe_eur < 0 then
    raise exception 'Una reserva negativa no es una reserva' using errcode = '22023';
  end if;
  if p_validez_segundos is null or p_validez_segundos < 1 or p_validez_segundos > 90000 then
    raise exception 'La validez de una reserva va de 1 segundo a 25 horas' using errcode = '22023';
  end if;
  if p_agente is null or btrim(p_agente) = '' then
    raise exception 'Toda reserva lleva agente' using errcode = '22023';
  end if;

  v_limite := app.bloquear_presupuesto(p_tenant, v_mes);

  if v_limite is null or v_limite = 0 then
    return jsonb_build_object(
      'permitida', false,
      'motivo', 'sin_presupuesto',
      'mensaje', 'Este corporate no tiene presupuesto de modelos para el mes en curso. Asígnale uno en Ajustes → Presupuesto.',
      'limite_eur', coalesce(v_limite, 0),
      'gastado_eur', app.gasto_del_mes(p_tenant, v_mes)
    );
  end if;

  v_gastado := app.gasto_del_mes(p_tenant, v_mes);

  if v_gastado >= v_limite then
    -- El corte se anota aunque llegue por aquí y no por una liquidación: el
    -- panel y el Copiloto leen `cortado` para decir por qué no se llama.
    perform app.cruzar_umbrales(p_tenant, v_mes);
    return jsonb_build_object(
      'permitida', false,
      'motivo', 'presupuesto_agotado',
      'mensaje', format(
        'Presupuesto del mes agotado: %s € de %s €. Amplíalo en Ajustes → Presupuesto para seguir.',
        to_char(v_gastado, 'FM999999990.0000'), to_char(v_limite, 'FM999999990.0000')),
      'limite_eur', v_limite,
      'gastado_eur', v_gastado
    );
  end if;

  v_reservado := app.reservado_vivo(p_tenant);
  v_libre := v_limite - v_gastado - v_reservado;

  if p_importe_eur > v_libre then
    return jsonb_build_object(
      'permitida', false,
      'motivo', 'presupuesto_insuficiente',
      'mensaje', format(
        'Esta llamada podría costar hasta %s € y quedan %s € libres este mes (%s € gastados y %s € reservados por llamadas en curso, de %s €).',
        to_char(p_importe_eur, 'FM999999990.000000'), to_char(greatest(v_libre, 0), 'FM999999990.000000'),
        to_char(v_gastado, 'FM999999990.0000'), to_char(v_reservado, 'FM999999990.0000'),
        to_char(v_limite, 'FM999999990.0000')),
      'limite_eur', v_limite,
      'gastado_eur', v_gastado,
      'reservado_eur', v_reservado
    );
  end if;

  insert into public.spend_reservations (
    tenant_id, agente, importe_eur, referencia, caduca_en, creado_por
  )
  values (
    p_tenant, p_agente, p_importe_eur, p_referencia,
    now() + make_interval(secs => p_validez_segundos), (select auth.uid())
  )
  returning id into v_reserva;

  return jsonb_build_object(
    'permitida', true,
    'motivo', 'ok',
    'reserva_id', v_reserva,
    'limite_eur', v_limite,
    'gastado_eur', v_gastado,
    'reservado_eur', v_reservado + p_importe_eur
  );
end
$$;

-- ── Liquidar: apuntar lo real y liberar la reserva ───────────────────────────

create or replace function app.liquidar_gasto(
  p_reserva        uuid,
  p_coste_eur      numeric,
  p_modelo         text,
  p_tokens_entrada integer default 0,
  p_tokens_salida  integer default 0,
  p_cache_leidos   integer default 0,
  p_cache_escritos integer default 0,
  p_cache_acertada boolean default false,
  p_modo           text default 'directo',
  p_referencia     text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_mes       date := date_trunc('month', now())::date;
  v_tenant    uuid;
  v_agente    text;
  v_liquidada timestamptz;
  v_limite    numeric;
  v_antes     numeric;
  v_despues   numeric;
  v_apunte    uuid;
  v_umbrales  text[] := array[]::text[];
begin
  if p_coste_eur is null or p_coste_eur < 0 then
    raise exception 'Un coste negativo no es un apunte' using errcode = '22023';
  end if;

  select tenant_id into v_tenant from public.spend_reservations where id = p_reserva;
  if v_tenant is null then
    raise exception 'La reserva % no existe o no es de un corporate tuyo', p_reserva using errcode = 'P0002';
  end if;

  -- El mismo orden de bloqueo que `autorizar_gasto`: primero el presupuesto del
  -- mes, después la reserva. Dos funciones que bloquean en el mismo orden no se
  -- pueden quedar esperándose la una a la otra.
  v_limite := app.bloquear_presupuesto(v_tenant, v_mes);

  select agente, liquidada_en into v_agente, v_liquidada
  from public.spend_reservations
  where id = p_reserva
  for update;

  if v_liquidada is not null then
    raise exception 'La reserva % ya se liquidó', p_reserva using errcode = '55000';
  end if;

  v_antes := app.gasto_del_mes(v_tenant, v_mes);

  -- Una llamada fallida sin consumo libera la reserva y no apunta nada: un
  -- apunte a cero no dice nada que no diga la traza.
  if p_coste_eur > 0 or coalesce(p_tokens_entrada, 0) + coalesce(p_tokens_salida, 0) > 0 then
    insert into public.spend_ledger (
      tenant_id, agente, concepto, modelo, tokens_entrada, tokens_salida,
      tokens_cache_leidos, tokens_cache_escritos, coste_eur, cache_acertada,
      modo, referencia, creado_por
    )
    values (
      v_tenant, v_agente, 'llm', p_modelo, coalesce(p_tokens_entrada, 0), coalesce(p_tokens_salida, 0),
      coalesce(p_cache_leidos, 0), coalesce(p_cache_escritos, 0), p_coste_eur,
      coalesce(p_cache_acertada, false), coalesce(p_modo, 'directo'), p_referencia, (select auth.uid())
    )
    returning id into v_apunte;
  end if;

  update public.spend_reservations
  set liquidada_en = now(), apunte_id = v_apunte
  where id = p_reserva;

  v_despues := v_antes + p_coste_eur;
  -- Si el mes cambió entre la reserva y la liquidación y el mes nuevo no tiene
  -- presupuesto, el gasto se apunta igual (se ha consumido) y no hay umbrales
  -- que cruzar: `cruzar_umbrales` devuelve la lista vacía.
  v_umbrales := app.cruzar_umbrales(v_tenant, v_mes);

  return jsonb_build_object(
    'apunte_id', v_apunte,
    'limite_eur', coalesce(v_limite, 0),
    'gastado_eur', v_despues,
    'umbrales_cruzados', to_jsonb(v_umbrales)
  );
end
$$;

revoke all on function
  app.bloquear_presupuesto(uuid, date),
  app.reservado_vivo(uuid),
  app.cruzar_umbrales(uuid, date),
  app.autorizar_gasto(uuid, numeric, text, text, integer),
  app.liquidar_gasto(uuid, numeric, text, integer, integer, integer, integer, boolean, text, text)
from public, anon;

grant execute on function
  app.bloquear_presupuesto(uuid, date),
  app.reservado_vivo(uuid),
  app.cruzar_umbrales(uuid, date),
  app.autorizar_gasto(uuid, numeric, text, text, integer),
  app.liquidar_gasto(uuid, numeric, text, integer, integer, integer, integer, boolean, text, text)
to authenticated, service_role;
