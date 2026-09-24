-- 0006 · Presupuesto, libro de gasto y máquinas (F1.13, F1.14)
--
-- La regla que implementa esto es una frase del plan: «un tenant sin
-- presupuesto no ejecuta llamadas LLM». Literalmente: si no hay fila de
-- presupuesto para el mes, o su límite es cero, la llamada se rechaza. El corte
-- es la ausencia de permiso, no un aviso que alguien tiene que leer.
--
-- Y va en la base, no en `packages/llm`, por una razón de concurrencia: dos
-- funciones de Inngest ejecutándose a la vez sobre el mismo tenant tienen que
-- ver el mismo gasto acumulado. Un contador en memoria de un proceso no corta
-- nada; un `select … for update` sobre la fila del mes, sí.

create table public.tenant_budgets (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- Primer día del mes al que se refiere el límite. Un límite por mes, con
  -- historial: subir el presupuesto en octubre no reescribe septiembre.
  mes            date not null,
  limite_eur     numeric(12,4) not null default 0 check (limite_eur >= 0),
  avisado_50     boolean not null default false,
  avisado_80     boolean not null default false,
  cortado        boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (tenant_id, mes),
  constraint tenant_budgets_mes_es_dia_uno check (mes = date_trunc('month', mes)::date)
);

alter table public.tenant_budgets enable row level security;

create policy tenant_budgets_lectura on public.tenant_budgets
  for select to authenticated
  using (app.es_miembro(tenant_id));

-- Cambiar el presupuesto es una decisión económica: administrador arriba.
create policy tenant_budgets_insertar on public.tenant_budgets
  for insert to authenticated
  with check (app.puede_administrar(tenant_id));

create policy tenant_budgets_actualizar on public.tenant_budgets
  for update to authenticated
  using (app.puede_administrar(tenant_id))
  with check (app.puede_administrar(tenant_id));

create trigger tenant_budgets_actualizado_en before update on public.tenant_budgets
  for each row execute function app.tocar_actualizado_en();

-- ── spend_ledger ─────────────────────────────────────────────────────────────
-- Append-only: el libro de gasto no se corrige, se compensa con otro apunte.

create table public.spend_ledger (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  fecha           date not null default (now() at time zone 'utc')::date,
  agente          text not null default 'sistema',
  concepto        text not null
                    check (concepto in ('llm','enriquecimiento','voz','firma','otro')),
  modelo          text,
  tokens_entrada  integer not null default 0 check (tokens_entrada >= 0),
  tokens_salida   integer not null default 0 check (tokens_salida >= 0),
  -- Seis decimales porque una clasificación con el modelo ligero cuesta menos
  -- de una milésima de euro y redondearla a cuatro la convierte en gratis.
  coste_eur       numeric(12,6) not null check (coste_eur >= 0),
  cache_acertada  boolean not null default false,
  referencia      text,
  event_id        uuid references public.events(id) on delete set null,
  creado_por      uuid references auth.users(id) on delete set null,
  creado_en       timestamptz not null default now()
);

create index spend_ledger_tenant_fecha on public.spend_ledger (tenant_id, fecha desc);
-- Sin índice funcional sobre `date_trunc('month', creado_en)`: con una columna
-- `timestamptz` esa función es STABLE, no IMMUTABLE, porque depende de la zona
-- horaria de la sesión, y Postgres no la admite en un índice. El índice por
-- `(tenant_id, creado_en)` sirve igual para el rango del mes.
create index spend_ledger_tenant_creado on public.spend_ledger (tenant_id, creado_en desc);
create index spend_ledger_tenant_agente on public.spend_ledger (tenant_id, agente, fecha desc);

alter table public.spend_ledger enable row level security;

create policy spend_ledger_lectura on public.spend_ledger
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy spend_ledger_insertar on public.spend_ledger
  for insert to authenticated
  with check (app.es_miembro(tenant_id));

create trigger spend_ledger_append_only
  before update or delete on public.spend_ledger
  for each row execute function app.impedir_modificacion();

-- ── machines ─────────────────────────────────────────────────────────────────
-- «Máquina» es la unidad que ejecuta un canal y tiene un límite propio (plan
-- §2.7). En F1 solo existe la tabla y su salud, que es lo que el panel de
-- inicio necesita; el planificador que calcula cuántas hacen falta llega en
-- F13. Un tenant nunca comparte una máquina con otro (ADR 0003, punto 8), y eso
-- lo garantiza el `tenant_id` obligatorio más la política de abajo.

create table public.machines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  tipo                text not null check (tipo in (
                        'buzon-google','buzon-m365','linkedin-free','linkedin-premium',
                        'linkedin-sales-navigator','linea-de-voz','api-social','worker'
                      )),
  nombre              text not null check (length(btrim(nombre)) between 2 and 120),
  estado              text not null default 'nueva'
                        check (estado in ('nueva','calentando','activa','pausada','restringida','retirada')),
  salud               text not null default 'desconocida'
                        check (salud in ('buena','degradada','mala','desconocida')),
  limite_diario       integer check (limite_diario is null or limite_diario >= 0),
  limite_semanal      integer check (limite_semanal is null or limite_semanal >= 0),
  calentamiento_desde date,
  ultima_revision_en  timestamptz,
  notas               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  unique (tenant_id, tipo, nombre)
);

create index machines_tenant on public.machines (tenant_id, estado);

alter table public.machines enable row level security;

create policy machines_lectura on public.machines
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy machines_insertar on public.machines
  for insert to authenticated
  with check (app.puede_administrar(tenant_id));

create policy machines_actualizar on public.machines
  for update to authenticated
  using (app.puede_administrar(tenant_id))
  with check (app.puede_administrar(tenant_id));

create policy machines_borrar on public.machines
  for delete to authenticated
  using (app.puede_administrar(tenant_id));

create trigger machines_actualizado_en before update on public.machines
  for each row execute function app.tocar_actualizado_en();

-- ── Gasto del mes ────────────────────────────────────────────────────────────

create or replace function app.gasto_del_mes(p_tenant uuid, p_mes date default null)
returns numeric
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce(sum(l.coste_eur), 0)::numeric
  from public.spend_ledger l
  where l.tenant_id = p_tenant
    and date_trunc('month', l.creado_en)::date
        = coalesce(p_mes, date_trunc('month', now())::date)
$$;

-- ── El cobro, que es también la puerta ───────────────────────────────────────
--
-- Devuelve un `jsonb` en vez de lanzar excepción cuando rechaza, porque quien
-- llama necesita poder contarlo: el panel enseña el motivo, el Copiloto lo
-- diagnostica (T2B.10) y el agente decide si reintenta mañana. Una excepción
-- aquí obligaría a leer el mensaje de error para saber qué pasó.
--
-- `security invoker` a propósito: el aislamiento lo aplica RLS sobre
-- `spend_ledger` y `tenant_budgets`. Si esta función fuera `security definer`,
-- cobrar en el presupuesto de otro corporate sería cuestión de pasar su uuid.

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
  select limite_eur, cortado, avisado_50, avisado_80
    into v_limite, v_cortado, v_avisado50, v_avisado80
  from public.tenant_budgets
  where tenant_id = p_tenant and mes = v_mes
  for update;

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

grant select, insert, update on public.tenant_budgets to authenticated;
grant select, insert on public.spend_ledger to authenticated;
grant select, insert, update, delete on public.machines to authenticated;

grant execute on function
  app.gasto_del_mes(uuid, date),
  app.cobrar_llamada(uuid, numeric, text, text, text, integer, integer, text, boolean)
to authenticated, service_role;
