-- 0002 · Bus de eventos y cola de aprobaciones (F1.10, F1.11)
--
-- `events` es la **fuente de verdad del sistema**, no la cola. Es la condición
-- con la que se aceptó Inngest en la ruta crítica (ADR 0002): todo evento se
-- persiste aquí antes de enviarse a la cola, así que un evento que Inngest
-- pierda sigue existiendo y se puede reinyectar con
-- `docs/runbooks/reproceso-de-eventos.md`.
--
-- Que sea append-only se garantiza con un trigger y no con una política,
-- porque las políticas RLS no se aplican al propietario de la tabla ni a
-- `service_role`. Una fuente de verdad que la llave maestra puede reescribir no
-- es una fuente de verdad.

-- ── events ───────────────────────────────────────────────────────────────────

create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  -- Nombre versionado del contrato (plan §2.5): `prospect.qualified` + 1.
  nombre              text not null check (nombre ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  version             integer not null default 1 check (version >= 1),
  agente              text not null default 'sistema',
  datos               jsonb not null default '{}'::jsonb,
  origen              text not null default 'panel'
                        check (origen in ('panel','api','webhook','inngest','sistema','worker','lab')),
  -- Para agrupar todo lo que pasó a raíz de una misma causa.
  correlacion_id      uuid,
  -- Idempotencia por tenant: reinyectar un evento con la misma clave no lo
  -- duplica. El runbook de reproceso depende de esto (paso 3).
  clave_idempotencia  text,
  creado_por          uuid references auth.users(id) on delete set null,
  creado_en           timestamptz not null default now()
);

create index events_tenant_creado on public.events (tenant_id, creado_en desc);
create index events_tenant_nombre on public.events (tenant_id, nombre, creado_en desc);
create unique index events_idempotencia
  on public.events (tenant_id, clave_idempotencia)
  where clave_idempotencia is not null;

alter table public.events enable row level security;

-- Cualquier miembro lee el registro de su tenant: es el visor de eventos y el
-- material con el que el Copiloto diagnostica (F2B.15).
create policy events_lectura on public.events
  for select to authenticated
  using (app.es_miembro(tenant_id));

-- Y cualquier miembro puede añadir, incluido un lector: la auditoría tiene que
-- registrar también lo que hace quien no puede editar nada.
create policy events_insertar on public.events
  for insert to authenticated
  with check (app.es_miembro(tenant_id));

-- Sin política de update ni de delete, a propósito. Y además:
create trigger events_append_only
  before update or delete on public.events
  for each row execute function app.impedir_modificacion();

-- ── event_runs ───────────────────────────────────────────────────────────────
-- Qué ejecución atendió cada evento. Es lo que permite responder «¿qué eventos
-- no tienen ejecución registrada?», que es el paso 1 del runbook de reproceso.

create table public.event_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  funcion       text not null,
  estado        text not null default 'en_curso'
                  check (estado in ('en_curso','completada','fallida','omitida')),
  inngest_run_id text,
  intento       integer not null default 1 check (intento >= 1),
  error         text,
  iniciado_en   timestamptz not null default now(),
  terminado_en  timestamptz
);

create index event_runs_evento on public.event_runs (event_id);
create index event_runs_tenant_estado on public.event_runs (tenant_id, estado, iniciado_en desc);

alter table public.event_runs enable row level security;

create policy event_runs_lectura on public.event_runs
  for select to authenticated
  using (app.es_miembro(tenant_id));

-- Las ejecuciones las escribe el orquestador, no una persona: sin políticas de
-- escritura para `authenticated`.

-- ── event_reinyecciones ──────────────────────────────────────────────────────
-- «Deja rastro: cada reinyección se apunta con quién, cuándo y por qué»
-- (runbook, paso 4). Append-only por el mismo motivo que `events`.

create table public.event_reinyecciones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  motivo      text not null check (length(btrim(motivo)) >= 3),
  quien       text not null,
  creado_en   timestamptz not null default now()
);

create index event_reinyecciones_tenant on public.event_reinyecciones (tenant_id, creado_en desc);

alter table public.event_reinyecciones enable row level security;

create policy event_reinyecciones_lectura on public.event_reinyecciones
  for select to authenticated
  using (app.es_miembro(tenant_id));

create trigger event_reinyecciones_append_only
  before update or delete on public.event_reinyecciones
  for each row execute function app.impedir_modificacion();

-- ── approvals ────────────────────────────────────────────────────────────────
-- Cola de revisión humana. Es el mecanismo del nivel de autonomía L1: el agente
-- propone, la persona aprueba, y solo entonces se emite el evento de la acción.

create table public.approvals (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  agente              text not null,
  tipo                text not null,
  titulo              text not null check (length(btrim(titulo)) between 3 and 200),
  estado              text not null default 'pendiente'
                        check (estado in ('pendiente','aprobada','rechazada','caducada')),
  -- Lo que propuso el agente, tal cual. Nunca se sobrescribe: si la persona
  -- edita, la edición va a `contenido_final` y las dos quedan comparables.
  contenido_propuesto jsonb not null,
  contenido_final     jsonb,
  editada             boolean not null default false,
  motivo              text,
  -- Evento que se emite al aprobar. Es el enganche entre la cola y el bus.
  evento_al_aprobar   text,
  evento_emitido_id   uuid references public.events(id) on delete set null,
  origen_event_id     uuid references public.events(id) on delete set null,
  creada_por          uuid references auth.users(id) on delete set null,
  creada_en           timestamptz not null default now(),
  resuelta_por        uuid references auth.users(id) on delete set null,
  resuelta_en         timestamptz,
  actualizado_en      timestamptz not null default now(),
  -- Una aprobación resuelta tiene que decir quién y cuándo. Si no, no es
  -- auditoría, es un cambio de estado.
  constraint approvals_resuelta_completa check (
    (estado = 'pendiente' and resuelta_por is null and resuelta_en is null)
    or (estado <> 'pendiente' and resuelta_en is not null)
  )
);

create index approvals_tenant_estado on public.approvals (tenant_id, estado, creada_en desc);

alter table public.approvals enable row level security;

create policy approvals_lectura on public.approvals
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy approvals_insertar on public.approvals
  for insert to authenticated
  with check (app.puede_editar(tenant_id));

-- Resolver una aprobación es una decisión, no una consulta: un lector no la
-- toma. Esto es la mitad de base de datos del caso T1.2.
create policy approvals_actualizar on public.approvals
  for update to authenticated
  using (app.puede_editar(tenant_id))
  with check (app.puede_editar(tenant_id));

create trigger approvals_actualizado_en before update on public.approvals
  for each row execute function app.tocar_actualizado_en();

-- ── Registrar un evento ──────────────────────────────────────────────────────
-- Un único camino de escritura en el bus, para que nadie se invente el formato
-- del nombre ni se olvide del tenant.

create or replace function app.registrar_evento(
  p_tenant             uuid,
  p_nombre             text,
  p_datos              jsonb default '{}'::jsonb,
  p_agente             text default 'sistema',
  p_origen             text default 'panel',
  p_version            integer default 1,
  p_correlacion_id     uuid default null,
  p_clave_idempotencia text default null
)
returns uuid
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.events (
    tenant_id, nombre, version, agente, datos, origen,
    correlacion_id, clave_idempotencia, creado_por
  )
  values (
    p_tenant, p_nombre, p_version, p_agente, coalesce(p_datos, '{}'::jsonb), p_origen,
    p_correlacion_id, p_clave_idempotencia, (select auth.uid())
  )
  on conflict (tenant_id, clave_idempotencia) where clave_idempotencia is not null
    do nothing
  returning id into v_id;

  -- Si la clave de idempotencia ya existía, devolvemos el evento que ya hay.
  if v_id is null and p_clave_idempotencia is not null then
    select id into v_id from public.events
    where tenant_id = p_tenant and clave_idempotencia = p_clave_idempotencia;
  end if;

  return v_id;
end
$$;

-- ── Privilegios ──────────────────────────────────────────────────────────────

grant select, insert on public.events to authenticated;
grant select on public.event_runs to authenticated;
grant select on public.event_reinyecciones to authenticated;
grant select, insert, update on public.approvals to authenticated;

grant execute on function
  app.registrar_evento(uuid, text, jsonb, text, text, integer, uuid, text)
to authenticated, service_role;
