-- Andamiaje de Supabase para las pruebas. **Nunca se aplica a una base real.**
--
-- Las migraciones de `packages/db/migraciones` dan por hecho lo que Supabase ya
-- trae: el esquema `auth` con su tabla de usuarios y `auth.uid()`, y los roles
-- `anon`, `authenticated` y `service_role`. Las pruebas de aislamiento corren
-- contra un Postgres embebido (PGlite) que no trae nada de eso, así que este
-- fichero lo reproduce con la misma forma.
--
-- Por qué un Postgres de verdad y no simulacros: lo que hay que probar es que
-- **la base** impide leer los datos de otro corporate. Una prueba con dobles
-- comprueba que el código llama a lo que creemos que llama, que es exactamente
-- lo que no falla. El caso T1.3 es innegociable y merece una base real.
--
-- Por qué embebido y no Docker: este test corre dentro de `pnpm verify`, y
-- `pnpm verify` corre dentro del build de Vercel, donde no hay Docker. Un test
-- de aislamiento que solo se puede ejecutar en el portátil de alguien no es una
-- puerta de calidad.

-- `gen_random_uuid()` es del núcleo de Postgres desde la 13, así que no hace
-- falta pgcrypto (que PGlite no trae).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- `service_role` salta RLS, igual que en Supabase. Es la llave maestra del
  -- ADR 0003 y por eso solo la usa `comoSistema`, con un motivo por escrito.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- **Esto es lo que más importa de este fichero.**
--
-- Supabase trae configurado `alter default privileges ... grant all on tables
-- to anon, authenticated, service_role` en `public`. Es decir: cada tabla que
-- creamos nace con **todos** los privilegios concedidos a los tres roles,
-- incluido el anónimo, sin que ninguna migración lo pida.
--
-- Reproducirlo aquí no es fidelidad decorativa. Sin esto, la comprobación «el
-- rol anónimo no tiene privilegios sobre ninguna tabla» pasaba en las pruebas
-- por el motivo equivocado —porque PGlite no concede nada— mientras en staging
-- `anon` tenía `TRUNCATE` sobre la tabla `events`. Y `truncate` no pasa por
-- RLS. Con estas dos líneas, ese test falla sin la migración 0008, que es lo
-- que tenía que haber hecho desde el principio.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- El sujeto del JWT de la petición. Sin claims devuelve null, y una política que
-- compara contra null no deja pasar nada: fallar cerrado es el comportamiento
-- correcto aquí.
--
-- El `nullif(…, '')` va **antes** del cast a `jsonb`, y no es un detalle de
-- estilo: así lo hace Supabase, y el camino de sistema (`service_role`) deja la
-- variable en cadena vacía. Casteando primero, `''::jsonb` lanza «invalid input
-- syntax for type json» y cualquier función que consulte la pertenencia revienta
-- en vez de responder «no hay sesión». Lo descubrió un test que pasaba en
-- staging y fallaba aquí, que es la dirección buena en la que descubrirlo.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )::text
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt()
  to anon, authenticated, service_role;
