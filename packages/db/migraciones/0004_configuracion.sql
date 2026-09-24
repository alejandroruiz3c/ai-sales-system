-- 0004 · Configuración de agentes y de pasos del flujo, versionada (F1.8, F1.12)
--
-- Las dos tablas son **append-only**: una versión guardada no se modifica
-- nunca. La configuración vigente es la de mayor `version`, y revertir no
-- deshace nada: crea una versión nueva con el contenido de una anterior y
-- apunta de dónde viene (`revertida_de`).
--
-- Se decidió así por el caso T1.5 —cambiar el tono, guardar y revertir, con las
-- dos versiones visibles en el historial—, pero el motivo de fondo es otro: si
-- revertir sobrescribiera, el historial de configuración tendría huecos justo
-- en los momentos que más importa poder reconstruir. Un tenant que pregunte
-- «¿con qué instrucciones se escribió este email de hace tres semanas?» tiene
-- derecho a una respuesta exacta.
--
-- El contenido de `config` lo valida Zod en `packages/db/src/esquema`, no la
-- base: un `jsonb` con esquema en la aplicación se puede evolucionar por tenant
-- y se puede enseñar en el Estudio (F2B.3). Lo que sí decide la base son las
-- cosas de las que depende el aislamiento o una salvaguarda: el tenant, el
-- agente y el nivel de autonomía.

create table public.agent_configs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- Clave del agente en el registro (`packages/studio`, F2B.2).
  agente           text not null check (agente ~ '^[a-z][a-z0-9-]{1,40}$'),
  version          integer not null check (version >= 1),
  config           jsonb not null,
  -- L0 propone y no envía · L1 envía con aprobación · L2 envía dentro de
  -- límites · L3 autónomo. El agente lee esto, no la UI (F1.12).
  nivel_autonomia  text not null default 'L1' check (nivel_autonomia in ('L0','L1','L2','L3')),
  nota             text,
  revertida_de     integer,
  creado_por       uuid references auth.users(id) on delete set null,
  creado_en        timestamptz not null default now(),
  unique (tenant_id, agente, version)
);

create index agent_configs_vigente
  on public.agent_configs (tenant_id, agente, version desc);

alter table public.agent_configs enable row level security;

create policy agent_configs_lectura on public.agent_configs
  for select to authenticated
  using (app.es_miembro(tenant_id));

-- Un lector ve toda la configuración y no guarda ninguna versión. Puede
-- proponer, y una propuesta es una fila de `approvals` (F2B.6/F2B.9).
create policy agent_configs_insertar on public.agent_configs
  for insert to authenticated
  with check (app.puede_editar(tenant_id));

create trigger agent_configs_append_only
  before update or delete on public.agent_configs
  for each row execute function app.impedir_modificacion();

-- ── flow_configs ─────────────────────────────────────────────────────────────

create table public.flow_configs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  paso         text not null check (paso ~ '^[a-z][a-z0-9-]{1,40}$'),
  version      integer not null check (version >= 1),
  config       jsonb not null,
  nota         text,
  revertida_de integer,
  creado_por   uuid references auth.users(id) on delete set null,
  creado_en    timestamptz not null default now(),
  unique (tenant_id, paso, version)
);

create index flow_configs_vigente
  on public.flow_configs (tenant_id, paso, version desc);

alter table public.flow_configs enable row level security;

create policy flow_configs_lectura on public.flow_configs
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy flow_configs_insertar on public.flow_configs
  for insert to authenticated
  with check (app.puede_editar(tenant_id));

create trigger flow_configs_append_only
  before update or delete on public.flow_configs
  for each row execute function app.impedir_modificacion();

-- ── Numeración de versiones ──────────────────────────────────────────────────
-- La versión la pone la base, no el cliente. Dos pestañas abiertas guardando a
-- la vez no pueden crear dos «versión 3» distintas, y el índice único garantiza
-- que si lo intentan, una de las dos falla en vez de perderse.

create or replace function app.asignar_version()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_siguiente integer;
begin
  if tg_table_name = 'agent_configs' then
    select coalesce(max(version), 0) + 1 into v_siguiente
    from public.agent_configs
    where tenant_id = new.tenant_id and agente = new.agente;
  else
    select coalesce(max(version), 0) + 1 into v_siguiente
    from public.flow_configs
    where tenant_id = new.tenant_id and paso = new.paso;
  end if;

  new.version := v_siguiente;
  return new;
end
$$;

create trigger agent_configs_version before insert on public.agent_configs
  for each row execute function app.asignar_version();

create trigger flow_configs_version before insert on public.flow_configs
  for each row execute function app.asignar_version();

-- ── Vistas de lo vigente ─────────────────────────────────────────────────────
-- `security_invoker` para que la vista no se salte RLS: sin eso, una vista es
-- un agujero con forma de comodidad.

create view public.agent_configs_vigentes
  with (security_invoker = true) as
select distinct on (tenant_id, agente) *
from public.agent_configs
order by tenant_id, agente, version desc;

create view public.flow_configs_vigentes
  with (security_invoker = true) as
select distinct on (tenant_id, paso) *
from public.flow_configs
order by tenant_id, paso, version desc;

grant select, insert on public.agent_configs to authenticated;
grant select, insert on public.flow_configs to authenticated;
grant select on public.agent_configs_vigentes to authenticated;
grant select on public.flow_configs_vigentes to authenticated;
