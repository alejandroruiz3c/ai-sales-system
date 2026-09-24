-- 0001 · Fundaciones del núcleo multi-tenant (F1.1, F1.2)
--
-- Aquí viven las tres piezas sin las que no hay sistema: el tenant, quién
-- pertenece a él y con qué rol, y las funciones con las que todas las demás
-- tablas deciden quién ve qué.
--
-- La política RLS de cada tabla se escribe **en esta misma migración**, junto a
-- la tabla, y no en código de aplicación (ADR 0003). El motivo es que una
-- política que vive en otro sitio es una política que alguien olvida aplicar, y
-- lo que se olvida aquí es el aislamiento entre corporates.
--
-- El orden del fichero es tablas → funciones → políticas, y no tabla a tabla
-- con lo suyo, por una razón de Postgres: el cuerpo de una función `language
-- sql` se valida al crearla, así que `app.es_miembro` no se puede declarar
-- antes de que exista `memberships`. La alternativa era escribirlas en plpgsql,
-- que no se valida, pero entonces el planificador no puede insertarlas dentro
-- de la política y el ADR 0003 pide justo lo contrario: políticas indexables.
--
-- Convención de la fase, y se sostiene en todas las migraciones siguientes:
--
--   · toda tabla de `public` lleva `tenant_id` y RLS activado;
--   · `select` se concede a cualquier miembro del tenant;
--   · escribir exige rol: `lector` nunca escribe, y eso lo decide la base, no
--     el panel. Un panel se puede saltar con curl;
--   · nada se concede al rol `anon`. Sin sesión no se lee una sola fila;
--   · las funciones de pertenencia son `security definer` porque tienen que
--     poder leer `memberships` sin que se les aplique la política que ellas
--     mismas resuelven. Todas fijan `search_path`.
--
-- Una cosa que **no** está y conviene explicar, porque parece un olvido:
-- ninguna tabla lleva `force row level security`. FORCE hace que RLS se aplique
-- también al propietario de la tabla, y el propietario es justo el rol con el
-- que se ejecutan las funciones `security definer` de pertenencia. Con FORCE,
-- `app.es_miembro` no podría leer `memberships` y respondería «no eres miembro
-- de nada» a todo el mundo: la armadura rompería el mecanismo que protege.
--
-- El agujero que FORCE taparía —que alguien consulte con el rol propietario y
-- no vea ninguna política— se tapa en el otro extremo, en `packages/db`:
--
--   · el manejador crudo de postgres.js **no se exporta**. Solo hay tres
--     formas de consultar, y las tres fijan el rol dentro de su transacción:
--     `conRLS` (rol `authenticated` con la identidad del usuario),
--     `comoSistema` (rol `service_role`, que salta RLS y exige un motivo por
--     escrito) y `conRolAnonimo` (rol `anon`, que no ve una sola fila);
--   · no hay cuarta puerta, así que no hay que acordarse de cerrarla;
--   · hay un test que lo comprueba (`pruebas/rls.test.ts`), porque una
--     convención sin test es una convención hasta que alguien tenga prisa.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · Esquema de utilidades
-- ═════════════════════════════════════════════════════════════════════════════
-- `app` guarda funciones y tablas de la plataforma. `public` guarda datos de
-- tenant. La separación permite que la comprobación «toda tabla lleva
-- tenant_id» recorra `public` entero sin excepciones que discutir.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Registro de migraciones aplicadas. Vive en `app` porque no es dato de tenant.
create table if not exists app.migraciones (
  nombre       text primary key,
  sha256       text not null,
  aplicada_en  timestamptz not null default now()
);

create or replace function app.tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end
$$;

-- Append-only de verdad: un trigger, no una política. Las políticas RLS no se
-- aplican al propietario de la tabla ni a `service_role`, y la tabla `events`
-- es la fuente de verdad del sistema (ADR 0002). Si se puede reescribir, no lo
-- es.
--
-- Con una sola excepción, y estrecha: **borrar un tenant entero**. El botón de
-- reset de `/lab` tiene que poder dejar un corporate de prueba en su estado
-- inicial (plan §5B.2), y para eso el `on delete cascade` tiene que llegar
-- hasta aquí. La excepción se abre con una marca de sesión que solo pone
-- `app.purgar_tenant_demo`, y por sí sola no sirve de nada: quien la ponga
-- sigue sin permiso de `delete` sobre estas tablas. La marca levanta el
-- trigger, no los permisos.
create or replace function app.impedir_modificacion()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.purga_de_tenant', true), 'off') = 'on' then
    return old;
  end if;

  raise exception
    'La tabla %.% es append-only y no admite %. La tabla de eventos es la fuente de verdad del sistema (ADR 0002).',
    tg_table_schema, tg_table_name, lower(tg_op)
    using errcode = '42501';
end
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Tablas
-- ═════════════════════════════════════════════════════════════════════════════

-- `perfiles` es la excepción consciente a «toda tabla lleva tenant_id»,
-- documentada en el ADR 0009: la identidad de una persona es anterior a los
-- tenants y atraviesa varios (un usuario puede ser lector en un corporate y
-- editor en otro). Su aislamiento no es por tenant sino por `auth.uid()`, que
-- es más estrecho.
create table public.perfiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text not null,
  nombre              text,
  es_admin_plataforma boolean not null default false,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

create unique index perfiles_email_unico on public.perfiles (lower(email));

create table public.tenants (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(btrim(nombre)) between 2 and 120),
  slug           text not null unique
                   check (slug ~ '^[a-z0-9]([a-z0-9-]{0,47}[a-z0-9])?$'),
  estado         text not null default 'activo'
                   check (estado in ('activo','suspendido','archivado')),
  zona_horaria   text not null default 'Europe/Madrid',
  idioma         text not null default 'es' check (idioma in ('es','en')),
  plan           text not null default 'piloto',
  -- Los corporates de prueba se dan de alta desde el panel y se borran enteros
  -- con el botón de reset de `/lab` (plan §5B.2). El sistema no trae ninguno.
  es_demo        boolean not null default false,
  creado_por     uuid references auth.users(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.memberships (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  rol            text not null
                   check (rol in ('propietario','administrador','editor','lector')),
  estado         text not null default 'activa' check (estado in ('activa','suspendida')),
  invitado_por   uuid references auth.users(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (tenant_id, usuario_id)
);

create index memberships_usuario on public.memberships (usuario_id) where estado = 'activa';
create index memberships_tenant on public.memberships (tenant_id);

-- El token de una invitación **no se guarda**: se guarda su sha256. Un volcado
-- de esta tabla no permite entrar en ningún tenant.
create table public.invitaciones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  rol         text not null check (rol in ('administrador','editor','lector')),
  token_hash  text not null unique,
  estado      text not null default 'pendiente'
                check (estado in ('pendiente','aceptada','revocada','caducada')),
  expira_en   timestamptz not null,
  creada_por  uuid references auth.users(id) on delete set null,
  creada_en   timestamptz not null default now(),
  aceptada_en timestamptz,
  usuario_id  uuid references auth.users(id) on delete set null
);

create unique index invitaciones_pendiente_unica
  on public.invitaciones (tenant_id, lower(email))
  where estado = 'pendiente';

create index invitaciones_tenant on public.invitaciones (tenant_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Funciones de pertenencia
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function app.es_miembro(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.usuario_id = (select auth.uid())
      and m.estado = 'activa'
  )
$$;

create or replace function app.tiene_rol(p_tenant uuid, variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant
      and m.usuario_id = (select auth.uid())
      and m.estado = 'activa'
      and m.rol = any(p_roles)
  )
$$;

-- Editor y por encima. Es el permiso de «cambiar cosas del tenant».
create or replace function app.puede_editar(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select app.tiene_rol(p_tenant, variadic array['propietario','administrador','editor'])
$$;

-- Administrador y por encima. Es el permiso de «tocar personas y secretos».
create or replace function app.puede_administrar(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select app.tiene_rol(p_tenant, variadic array['propietario','administrador'])
$$;

-- Dos usuarios comparten tenant. Sirve para que una persona vea el nombre de
-- sus compañeros sin poder enumerar a los usuarios del sistema entero.
create or replace function app.comparte_tenant(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.memberships mio
    join public.memberships suyo on suyo.tenant_id = mio.tenant_id
    where mio.usuario_id = (select auth.uid())
      and mio.estado = 'activa'
      and suyo.usuario_id = p_usuario
      and suyo.estado = 'activa'
  )
$$;

-- Administrador de la plataforma. No es un rol de tenant: es quien opera SALES
-- OS. No le da acceso a los datos de ningún corporate; le da acceso a `/lab` y
-- a las salvaguardas bloqueadas (plan §F2B).
create or replace function app.es_admin_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select coalesce(
    (select p.es_admin_plataforma from public.perfiles p where p.id = (select auth.uid())),
    false
  )
$$;

-- Un tenant sin propietario es un tenant que nadie puede administrar nunca más.
create or replace function app.impedir_tenant_sin_propietario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_tenant uuid := coalesce(old.tenant_id, new.tenant_id);
begin
  if not exists (
    select 1 from public.memberships m
    where m.tenant_id = v_tenant and m.rol = 'propietario' and m.estado = 'activa'
  ) and exists (select 1 from public.tenants t where t.id = v_tenant) then
    raise exception 'Un tenant no se puede quedar sin propietario activo'
      using errcode = '23514';
  end if;
  return null;
end
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · Row Level Security
-- ═════════════════════════════════════════════════════════════════════════════

-- ── perfiles ─────────────────────────────────────────────────────────────────

alter table public.perfiles enable row level security;

create policy perfiles_lectura on public.perfiles
  for select to authenticated
  using (id = (select auth.uid()) or app.comparte_tenant(id));

-- Cada uno edita su propio perfil, y solo su nombre: `es_admin_plataforma` no
-- aparece en el `grant` de columnas de abajo, así que nadie se asciende a sí
-- mismo ni con la política a favor.
create policy perfiles_actualizar_propio on public.perfiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── tenants ──────────────────────────────────────────────────────────────────

alter table public.tenants enable row level security;

create policy tenants_lectura on public.tenants
  for select to authenticated
  using (app.es_miembro(id));

create policy tenants_actualizar on public.tenants
  for update to authenticated
  using (app.puede_administrar(id))
  with check (app.puede_administrar(id));

-- Borrar un tenant borra el corporate entero. Solo el propietario.
create policy tenants_borrar on public.tenants
  for delete to authenticated
  using (app.tiene_rol(id, variadic array['propietario']));

-- No hay política de `insert`: un tenant se crea con `app.crear_tenant`
-- (migración 0007), que es `security definer` y da de alta al creador como
-- propietario en la misma transacción. Sin eso, quien crea el tenant no podría
-- ni verlo.

-- ── memberships ──────────────────────────────────────────────────────────────

alter table public.memberships enable row level security;

-- Uno ve sus propias pertenencias siempre (las necesita para el selector de
-- tenant) y las de los demás solo si administra ese tenant.
create policy memberships_lectura on public.memberships
  for select to authenticated
  using (usuario_id = (select auth.uid()) or app.puede_administrar(tenant_id));

create policy memberships_insertar on public.memberships
  for insert to authenticated
  with check (app.puede_administrar(tenant_id));

create policy memberships_actualizar on public.memberships
  for update to authenticated
  using (app.puede_administrar(tenant_id))
  with check (app.puede_administrar(tenant_id));

create policy memberships_borrar on public.memberships
  for delete to authenticated
  using (app.puede_administrar(tenant_id));

-- ── invitaciones ─────────────────────────────────────────────────────────────

alter table public.invitaciones enable row level security;

create policy invitaciones_lectura on public.invitaciones
  for select to authenticated
  using (app.puede_administrar(tenant_id));

create policy invitaciones_insertar on public.invitaciones
  for insert to authenticated
  with check (app.puede_administrar(tenant_id));

create policy invitaciones_actualizar on public.invitaciones
  for update to authenticated
  using (app.puede_administrar(tenant_id))
  with check (app.puede_administrar(tenant_id));

create policy invitaciones_borrar on public.invitaciones
  for delete to authenticated
  using (app.puede_administrar(tenant_id));

-- ═════════════════════════════════════════════════════════════════════════════
-- 5 · Triggers y privilegios
-- ═════════════════════════════════════════════════════════════════════════════

create trigger perfiles_actualizado_en before update on public.perfiles
  for each row execute function app.tocar_actualizado_en();

create trigger tenants_actualizado_en before update on public.tenants
  for each row execute function app.tocar_actualizado_en();

create trigger memberships_actualizado_en before update on public.memberships
  for each row execute function app.tocar_actualizado_en();

create constraint trigger memberships_con_propietario
  after update or delete on public.memberships
  deferrable initially deferred
  for each row execute function app.impedir_tenant_sin_propietario();

-- RLS solo filtra lo que el rol ya tiene derecho a tocar. Los `grant` van
-- explícitos y `anon` no recibe nada: sin sesión no se lee una sola fila.

grant select, update (nombre) on public.perfiles to authenticated;
grant select, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitaciones to authenticated;

grant execute on function
  app.es_miembro(uuid),
  app.tiene_rol(uuid, text[]),
  app.puede_editar(uuid),
  app.puede_administrar(uuid),
  app.comparte_tenant(uuid),
  app.es_admin_plataforma()
to authenticated, service_role;
