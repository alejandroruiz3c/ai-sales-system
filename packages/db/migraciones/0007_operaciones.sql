-- 0007 · Operaciones que tocan varias tablas a la vez
--
-- Todo lo que tiene que pasar entero o no pasar: crear un corporate, aceptar
-- una invitación, resolver una aprobación, borrar un corporate de prueba.
-- Están en la base y no en TypeScript porque la atomicidad la da la
-- transacción, y porque así el panel, un worker y un test hacen lo mismo.
--
-- Criterio para elegir `security definer`: solo cuando la operación tiene que
-- crear el permiso que ella misma necesitaría. Crear un tenant y aceptar una
-- invitación lo cumplen (nadie es miembro todavía). Resolver una aprobación no:
-- ahí el permiso ya existe o no existe, y quien decide es RLS.

-- ── Perfil automático al crear un usuario ────────────────────────────────────
-- El panel también inserta el perfil al dar de alta, pero un usuario creado por
-- otro camino (consola de Supabase, recuperación) no puede quedarse sin él: sin
-- perfil no hay nombre que enseñar ni forma de saber si es admin de plataforma.

create or replace function app.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'nombre', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists usuarios_con_perfil on auth.users;
    create trigger usuarios_con_perfil
      after insert on auth.users
      for each row execute function app.crear_perfil_de_usuario();
  end if;
end
$$;

-- ── Crear un corporate ───────────────────────────────────────────────────────
-- Cuatro escrituras en una transacción: el tenant, la pertenencia de quien lo
-- crea como propietario, el presupuesto del mes en curso y el evento.
--
-- El presupuesto se crea aquí y no perezosamente porque `app.cobrar_llamada`
-- rechaza toda llamada si no hay fila («un tenant sin presupuesto no ejecuta
-- llamadas LLM», F1.13). Un corporate recién creado sin fila de presupuesto
-- parecería roto en vez de sin configurar.

create or replace function app.crear_tenant(
  p_nombre       text,
  p_slug         text,
  p_zona         text default 'Europe/Madrid',
  p_idioma       text default 'es',
  p_es_demo      boolean default false,
  p_presupuesto  numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_id      uuid;
begin
  if v_usuario is null then
    raise exception 'Crear un corporate exige sesión' using errcode = '42501';
  end if;
  if p_presupuesto is null or p_presupuesto < 0 then
    raise exception 'El presupuesto mensual no puede ser negativo' using errcode = '22023';
  end if;

  insert into public.tenants (nombre, slug, zona_horaria, idioma, es_demo, creado_por)
  values (btrim(p_nombre), p_slug, p_zona, p_idioma, p_es_demo, v_usuario)
  returning id into v_id;

  insert into public.memberships (tenant_id, usuario_id, rol)
  values (v_id, v_usuario, 'propietario');

  insert into public.tenant_budgets (tenant_id, mes, limite_eur)
  values (v_id, date_trunc('month', now())::date, p_presupuesto);

  perform app.registrar_evento(
    v_id,
    'tenant.created',
    jsonb_build_object(
      'nombre', btrim(p_nombre),
      'slug', p_slug,
      'es_demo', p_es_demo,
      'presupuesto_mensual_eur', p_presupuesto
    ),
    'sistema',
    'panel'
  );

  return v_id;
end
$$;

-- ── Aceptar una invitación ───────────────────────────────────────────────────
-- Se busca por el sha256 del token, que es lo único que guardamos. Y se exige
-- que el email de la invitación sea el del usuario que la acepta: sin eso, un
-- enlace reenviado por error da acceso a quien lo reciba.

create or replace function app.aceptar_invitacion(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_email   text;
  v_inv     public.invitaciones;
begin
  if v_usuario is null then
    raise exception 'Aceptar una invitación exige sesión' using errcode = '42501';
  end if;

  select email into v_email from public.perfiles where id = v_usuario;

  select * into v_inv from public.invitaciones
  where token_hash = p_token_hash
  for update;

  if v_inv.id is null then
    raise exception 'Invitación no encontrada' using errcode = 'P0002';
  end if;
  if v_inv.estado <> 'pendiente' then
    raise exception 'Esta invitación ya está %', v_inv.estado using errcode = '22023';
  end if;
  -- Sin `update` a 'caducada' aquí: la excepción de la línea siguiente deshace
  -- la transacción entera, así que ese apunte nunca llegaría a existir. Lo que
  -- marca las caducadas es `app.caducar_invitaciones`, que corre aparte. El
  -- dato que manda es `expira_en`, no el estado.
  if v_inv.expira_en < now() then
    raise exception 'La invitación ha caducado' using errcode = '22023';
  end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Esta invitación es para otra dirección de correo'
      using errcode = '42501';
  end if;

  insert into public.memberships (tenant_id, usuario_id, rol, invitado_por)
  values (v_inv.tenant_id, v_usuario, v_inv.rol, v_inv.creada_por)
  on conflict (tenant_id, usuario_id)
    do update set rol = excluded.rol, estado = 'activa';

  update public.invitaciones
  set estado = 'aceptada', aceptada_en = now(), usuario_id = v_usuario
  where id = v_inv.id;

  perform app.registrar_evento(
    v_inv.tenant_id,
    'membership.accepted',
    jsonb_build_object('rol', v_inv.rol),
    'sistema',
    'panel'
  );

  return v_inv.tenant_id;
end
$$;

-- ── Caducar invitaciones ─────────────────────────────────────────────────────
-- Barrido de higiene: pasa a 'caducada' lo que ya venció. No es lo que decide
-- si una invitación vale —eso lo decide `expira_en` en el momento de usarla—,
-- sino lo que mantiene legible la lista del panel.

create or replace function app.caducar_invitaciones(p_tenant uuid default null)
returns integer
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_cuantas integer;
begin
  update public.invitaciones
  set estado = 'caducada'
  where estado = 'pendiente'
    and expira_en < now()
    and (p_tenant is null or tenant_id = p_tenant);

  get diagnostics v_cuantas = row_count;
  return v_cuantas;
end
$$;

-- ── Resolver una aprobación ──────────────────────────────────────────────────
-- Aprobar emite el evento que la aprobación llevaba anotado. Es el enganche
-- entre la cola humana y el bus: hasta que alguien aprueba, el evento de la
-- acción no existe, y por tanto la acción no ocurre (nivel L1).

create or replace function app.resolver_aprobacion(
  p_id              uuid,
  p_estado          text,
  p_contenido_final jsonb default null,
  p_motivo          text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_ap      public.approvals;
  v_evento  uuid;
  v_editada boolean;
begin
  if p_estado not in ('aprobada','rechazada') then
    raise exception 'Una aprobación se resuelve como aprobada o rechazada, no como %', p_estado
      using errcode = '22023';
  end if;

  select * into v_ap from public.approvals where id = p_id for update;

  if v_ap.id is null then
    raise exception 'Aprobación no encontrada' using errcode = 'P0002';
  end if;
  if v_ap.estado <> 'pendiente' then
    raise exception 'Esta aprobación ya está %', v_ap.estado using errcode = '22023';
  end if;

  v_editada := p_contenido_final is not null
               and p_contenido_final <> v_ap.contenido_propuesto;

  if p_estado = 'aprobada' and v_ap.evento_al_aprobar is not null then
    v_evento := app.registrar_evento(
      v_ap.tenant_id,
      v_ap.evento_al_aprobar,
      jsonb_build_object(
        'approval_id', v_ap.id,
        'editada', v_editada,
        'contenido', coalesce(p_contenido_final, v_ap.contenido_propuesto)
      ),
      v_ap.agente,
      'panel'
    );
  end if;

  update public.approvals
  set estado            = p_estado,
      contenido_final   = coalesce(p_contenido_final, v_ap.contenido_propuesto),
      editada           = v_editada,
      motivo            = p_motivo,
      evento_emitido_id = v_evento,
      resuelta_por      = (select auth.uid()),
      resuelta_en       = now()
  where id = p_id;

  perform app.registrar_evento(
    v_ap.tenant_id,
    case when p_estado = 'aprobada' then 'approval.granted' else 'approval.rejected' end,
    jsonb_build_object('approval_id', v_ap.id, 'editada', v_editada, 'tipo', v_ap.tipo),
    v_ap.agente,
    'panel'
  );

  return jsonb_build_object(
    'id', v_ap.id,
    'estado', p_estado,
    'editada', v_editada,
    'evento_emitido_id', v_evento
  );
end
$$;

-- ── Borrar un corporate de prueba ────────────────────────────────────────────
-- El botón «Reset tenant de pruebas» de `/lab` (plan §5B.2). Solo sobre
-- corporates marcados `es_demo`: un corporate real no se borra desde un botón.
--
-- La marca de sesión levanta el trigger append-only para que el `on delete
-- cascade` pueda llegar a `events` y a `spend_ledger`. Es local a la
-- transacción y no concede ningún permiso por sí misma.

create or replace function app.purgar_tenant_demo(p_tenant uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_es_demo boolean;
  v_nombre  text;
begin
  select es_demo, nombre into v_es_demo, v_nombre
  from public.tenants where id = p_tenant;

  if v_es_demo is null then
    return false;
  end if;
  if not v_es_demo then
    raise exception
      'Solo se pueden borrar corporates de prueba. "%" no está marcado como demo.', v_nombre
      using errcode = '42501';
  end if;
  if not (app.tiene_rol(p_tenant, variadic array['propietario']) or app.es_admin_plataforma()) then
    raise exception 'Borrar un corporate exige ser su propietario o administrador de plataforma'
      using errcode = '42501';
  end if;

  perform set_config('app.purga_de_tenant', 'on', true);
  delete from public.tenants where id = p_tenant;
  perform set_config('app.purga_de_tenant', 'off', true);

  return true;
end
$$;

-- ── Huecos de entrega ────────────────────────────────────────────────────────
-- Paso 1 del runbook de reproceso: eventos publicados sin ejecución registrada.
-- «Siempre con tenant_id. Un reproceso sin tenant es un reproceso en los datos
-- de otro corporate.»

create or replace function app.eventos_sin_ejecucion(
  p_tenant uuid,
  p_desde  timestamptz default (now() - interval '24 hours'),
  p_hasta  timestamptz default now()
)
returns table (
  id        uuid,
  nombre    text,
  version   integer,
  agente    text,
  creado_en timestamptz
)
language sql
stable
set search_path = public, pg_catalog, pg_temp
as $$
  select e.id, e.nombre, e.version, e.agente, e.creado_en
  from public.events e
  left join public.event_runs r on r.event_id = e.id
  where e.tenant_id = p_tenant
    and e.creado_en between p_desde and p_hasta
    and r.id is null
  order by e.creado_en
$$;

-- ── Resumen del panel de inicio ──────────────────────────────────────────────
-- Un solo viaje a la base para el panel de inicio (F1.14). El embudo se cuenta
-- sobre `events`, que es la fuente de verdad: así las métricas no pueden
-- discrepar del registro de auditoría.
--
-- En F1 casi todo vale cero, y el panel lo dice en vez de enseñar un cero que
-- parezca un fallo. Los contadores se llenan solos a partir de F5, cuando
-- empiecen a existir los eventos que cuentan.

create or replace function app.resumen_del_tenant(p_tenant uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_mes        date := date_trunc('month', now())::date;
  v_gastado    numeric;
  v_limite     numeric;
  v_cortado    boolean;
  v_avisado50  boolean;
  v_avisado80  boolean;
  v_ingestados bigint;
  v_cualif     bigint;
  v_reuniones  bigint;
  v_cierres    bigint;
begin
  if not app.es_miembro(p_tenant) then
    raise exception 'Sin acceso a este corporate' using errcode = '42501';
  end if;

  select limite_eur, cortado, avisado_50, avisado_80
    into v_limite, v_cortado, v_avisado50, v_avisado80
  from public.tenant_budgets where tenant_id = p_tenant and mes = v_mes;

  v_gastado := app.gasto_del_mes(p_tenant, v_mes);

  select
    count(*) filter (where nombre = 'prospect.ingested'),
    count(*) filter (where nombre = 'prospect.qualified'),
    count(*) filter (where nombre = 'meeting.booked'),
    count(*) filter (where nombre = 'deal.won')
  into v_ingestados, v_cualif, v_reuniones, v_cierres
  from public.events
  where tenant_id = p_tenant
    and creado_en >= date_trunc('month', now());

  return jsonb_build_object(
    'mes', v_mes,
    'embudo', jsonb_build_object(
      'ingestados', v_ingestados,
      'cualificados', v_cualif,
      'reuniones', v_reuniones,
      'cierres', v_cierres
    ),
    'coste', jsonb_build_object(
      'gastado_eur', v_gastado,
      'limite_eur', coalesce(v_limite, 0),
      'porcentaje', case when coalesce(v_limite, 0) > 0
                      then round((v_gastado / v_limite) * 100, 2) else null end,
      'cortado', coalesce(v_cortado, false),
      'avisado_50', coalesce(v_avisado50, false),
      'avisado_80', coalesce(v_avisado80, false),
      'por_cualificado_eur', case when v_cualif > 0
                               then round(v_gastado / v_cualif, 4) else null end,
      'por_reunion_eur', case when v_reuniones > 0
                           then round(v_gastado / v_reuniones, 4) else null end,
      'por_cierre_eur', case when v_cierres > 0
                          then round(v_gastado / v_cierres, 4) else null end
    ),
    'maquinas', coalesce((
      select jsonb_object_agg(salud, n) from (
        select salud, count(*) as n from public.machines
        where tenant_id = p_tenant and estado <> 'retirada'
        group by salud
      ) s
    ), '{}'::jsonb),
    'aprobaciones_pendientes', (
      select count(*) from public.approvals
      where tenant_id = p_tenant and estado = 'pendiente'
    ),
    'eventos_7_dias', (
      select count(*) from public.events
      where tenant_id = p_tenant and creado_en > now() - interval '7 days'
    ),
    'archivos', (
      select count(*) from public.tenant_files
      where tenant_id = p_tenant and borrado_en is null
    )
  );
end
$$;

grant execute on function
  app.crear_tenant(text, text, text, text, boolean, numeric),
  app.aceptar_invitacion(text),
  app.caducar_invitaciones(uuid),
  app.resolver_aprobacion(uuid, text, jsonb, text),
  app.purgar_tenant_demo(uuid),
  app.eventos_sin_ejecucion(uuid, timestamptz, timestamptz),
  app.resumen_del_tenant(uuid)
to authenticated, service_role;
