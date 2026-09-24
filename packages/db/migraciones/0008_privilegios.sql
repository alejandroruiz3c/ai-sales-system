-- 0008 · Quitar los privilegios que Supabase concede por su cuenta
--
-- Esta migración corrige un agujero que las pruebas con Postgres embebido no
-- podían encontrar, y conviene entender por qué para no repetirlo.
--
-- Supabase trae configurados `alter default privileges ... grant all on tables
-- to anon, authenticated, service_role` en el esquema `public`, desde dos roles
-- concedentes (`postgres` y `supabase_admin`). Es decir: **cada tabla que
-- creamos nace con todos los privilegios concedidos a `anon`**, incluido el rol
-- sin sesión, sin que ninguna de nuestras migraciones lo pida.
--
-- Las migraciones 0001–0006 concedían explícitamente lo que cada tabla
-- necesita, y eso estaba bien, pero **conceder no quita**: encima de nuestros
-- `grant` seguían los suyos. El resultado real en staging, medido:
--
--   · `anon` tenía SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES y
--     TRIGGER sobre las 18 tablas y vistas de `public`;
--   · `authenticated` tenía lo mismo, **incluido sobre `tenant_secrets`**, que
--     es justo la tabla cuya garantía es que una sesión de usuario no la puede
--     tocar (F1.7).
--
-- De los siete privilegios, seis los neutraliza RLS: sin política que case, un
-- `select` devuelve cero filas y un `insert` se rechaza. **`TRUNCATE` no.**
-- `truncate` no pasa por las políticas de fila, así que cualquier usuario
-- autenticado —y en el caso de `anon`, cualquiera con la clave pública, que va
-- en el JavaScript del navegador— podía vaciar la tabla `events` del sistema
-- entero. No es una fuga de datos: es peor de operar, porque es una pérdida.
--
-- Por qué el test no lo vio: PGlite no trae los `alter default privileges` de
-- Supabase, así que allí `anon` no recibía nada y la comprobación «el rol
-- anónimo no tiene privilegios sobre ninguna tabla» pasaba por el motivo
-- equivocado. Se ha corregido el andamiaje de pruebas
-- (`pruebas/shim-supabase.sql`) para que conceda los mismos privilegios por
-- defecto que Supabase. Con ese cambio, el test falla sin esta migración.
--
-- A partir de aquí, los privilegios por defecto quedan retirados, así que una
-- tabla nueva nace **sin nada** para `anon` y `authenticated`, y el `grant`
-- explícito de su propia migración es el único que hay. Que es como tenía que
-- haber sido desde el principio.

-- ── 1 · Que las tablas futuras no nazcan concedidas ──────────────────────────
-- Se retira desde los dos roles concedentes. El bloque tolera el fallo de
-- `supabase_admin` porque el rol de la migración no siempre puede alterar los
-- privilegios por defecto de otro; si no puede, el paso 2 sigue limpiando lo
-- que ya existe y la tabla nueva se limpia en su propia migración.

do $$
begin
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'Sin permiso para alterar los privilegios por defecto de postgres: se limpia lo existente igualmente';
end
$$;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated';
exception when insufficient_privilege or undefined_object then
  raise notice 'Sin permiso para alterar los privilegios por defecto de supabase_admin (normal fuera de Supabase)';
end
$$;

-- ── 2 · Retirar lo ya concedido ──────────────────────────────────────────────
-- A cero, y desde cero. `anon` no vuelve a recibir nada en ningún momento de
-- esta migración: sin sesión no se lee una sola fila.

do $$
begin
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke all on all tables in schema public from authenticated';
  execute 'revoke all on all sequences in schema public from authenticated';
exception when undefined_object then
  raise notice 'Alguno de los roles no existe en esta base';
end
$$;

-- ── 3 · Volver a conceder exactamente lo necesario ───────────────────────────
-- Es la misma lista que declaran las migraciones 0001–0006, repetida aquí una
-- vez porque el `revoke` del paso 2 se las lleva todas. No vuelve a repetirse:
-- desde ahora cada tabla nueva declara su `grant` en su migración y nadie se lo
-- pisa.
--
-- Cuatro cosas que **no** se conceden a nadie, y no por olvido:
--
--   · `truncate`, porque no pasa por RLS. Vaciar una tabla es una operación de
--     administración de la base, no de la aplicación;
--   · `references` y `trigger`, que permitirían atar objetos nuevos a nuestras
--     tablas;
--   · nada en absoluto sobre `tenant_secrets` (F1.7) ni de escritura sobre
--     `event_runs` y `event_reinyecciones`, que las escribe el orquestador.

grant select on public.perfiles to authenticated;
grant update (nombre) on public.perfiles to authenticated;
grant select, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitaciones to authenticated;

grant select, insert on public.events to authenticated;
grant select on public.event_runs to authenticated;
grant select on public.event_reinyecciones to authenticated;
grant select, insert, update on public.approvals to authenticated;

grant select, insert, update, delete on public.tenant_files to authenticated;
grant select, insert on public.tenant_file_versions to authenticated;

grant select, insert on public.agent_configs to authenticated;
grant select, insert on public.flow_configs to authenticated;
grant select on public.agent_configs_vigentes to authenticated;
grant select on public.flow_configs_vigentes to authenticated;

grant select, insert, update on public.tenant_budgets to authenticated;
grant select, insert on public.spend_ledger to authenticated;
grant select, insert, update, delete on public.machines to authenticated;

-- `service_role` sí recibe todo: es la llave maestra del ADR 0003, salta RLS
-- por diseño y solo la usa `comoSistema`, con un motivo por escrito.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ── 4 · La firma de Vault en Supabase no es la que suponía 0005 ───────────────
-- Medido en staging: la función es
-- `vault.create_secret(new_secret text, new_name text, new_description text,
-- new_key_id uuid)` y `vault.update_secret(secret_id uuid, new_secret text,
-- new_name text, new_description text, new_key_id uuid)`. La versión de tres
-- argumentos que buscaba 0005 no existe, así que `app.guardar_secreto` fallaba
-- con «Vault no está disponible» en una base donde Vault sí está.
--
-- Se prueban las dos formas en tiempo de ejecución en vez de fijar una: la
-- extensión ha cambiado de firma al menos una vez y volverá a hacerlo, y el
-- coste de equivocarse es que un tenant no puede conectar su CRM.

create or replace function app.guardar_secreto(
  p_tenant      uuid,
  p_nombre      text,
  p_valor       text,
  p_descripcion text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_existente uuid;
  v_vault_id  uuid;
  v_etiqueta  text := 'tenant:' || p_tenant::text || ':' || p_nombre;
  v_desc      text := coalesce(p_descripcion, '');
begin
  if p_valor is null or length(p_valor) = 0 then
    raise exception 'Un secreto vacío no se guarda' using errcode = '22023';
  end if;

  select vault_secret_id into v_existente
  from public.tenant_secrets
  where tenant_id = p_tenant and nombre = p_nombre;

  if v_existente is null then
    if to_regprocedure('vault.create_secret(text,text,text,uuid)') is not null then
      execute 'select vault.create_secret($1, $2, $3, null::uuid)'
        into v_vault_id using p_valor, v_etiqueta, v_desc;
    elsif to_regprocedure('vault.create_secret(text,text,text)') is not null then
      execute 'select vault.create_secret($1, $2, $3)'
        into v_vault_id using p_valor, v_etiqueta, v_desc;
    else
      raise exception
        'Supabase Vault no está disponible en esta base: un secreto de tenant no se guarda en claro'
        using errcode = '0A000';
    end if;

    insert into public.tenant_secrets (tenant_id, nombre, vault_secret_id, descripcion, creado_por)
    values (p_tenant, p_nombre, v_vault_id, p_descripcion, (select auth.uid()));
  else
    if to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is not null then
      execute 'select vault.update_secret($1, $2, $3, $4, null::uuid)'
        using v_existente, p_valor, v_etiqueta, v_desc;
    elsif to_regprocedure('vault.update_secret(uuid,text,text,text)') is not null then
      execute 'select vault.update_secret($1, $2, $3, $4)'
        using v_existente, p_valor, v_etiqueta, v_desc;
    else
      raise exception 'Supabase Vault no está disponible en esta base' using errcode = '0A000';
    end if;

    update public.tenant_secrets
    set descripcion = coalesce(p_descripcion, descripcion)
    where tenant_id = p_tenant and nombre = p_nombre;

    v_vault_id := v_existente;
  end if;

  perform app.registrar_evento(
    p_tenant,
    'tenant.secret.saved',
    jsonb_build_object('nombre', p_nombre),
    'sistema',
    'sistema'
  );

  return v_vault_id;
end
$$;

revoke all on function app.guardar_secreto(uuid, text, text, text) from public, anon, authenticated;
grant execute on function app.guardar_secreto(uuid, text, text, text) to service_role;

-- Y las otras tres, por si el paso 1 las dejó con `execute` para `anon`: en
-- Supabase los privilegios por defecto de funciones también incluyen `anon`.
revoke all on function app.leer_secreto(uuid, text) from public, anon, authenticated;
revoke all on function app.borrar_secreto(uuid, text) from public, anon, authenticated;
revoke all on function app.listar_secretos(uuid) from public, anon;

grant execute on function app.leer_secreto(uuid, text) to service_role;
grant execute on function app.borrar_secreto(uuid, text) to service_role;
grant execute on function app.listar_secretos(uuid) to authenticated, service_role;
