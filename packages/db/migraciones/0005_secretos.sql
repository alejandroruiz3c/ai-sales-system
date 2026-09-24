-- 0005 · Secretos por tenant, cifrados en Vault (F1.7)
--
-- Lo que hay que garantizar es una frase del plan: **un secreto de tenant nunca
-- vuelve al frontend**. Se puede intentar de tres formas y solo una aguanta.
--
--   · Que la UI no lo pinte. No aguanta: `curl` no usa la UI.
--   · Que la API no lo devuelva. Aguanta hasta el primer endpoint nuevo que
--     alguien escriba con prisa.
--   · **Que el rol con el que habla el panel no tenga forma de leerlo.** Esta.
--
-- Así está montado: `tenant_secrets` tiene RLS activado y **ninguna política
-- para `authenticated`**, y ningún `grant`. Con la sesión de un usuario la
-- tabla no devuelve cero filas: devuelve «permiso denegado». El valor solo lo
-- lee `app.leer_secreto`, cuyo `execute` se concede **solo a `service_role`**.
-- Un endpoint escrito con prisa no puede filtrar lo que su conexión no puede
-- leer.
--
-- Lo que sí puede ver un administrador del tenant es el inventario: qué
-- credenciales hay configuradas, su descripción y cuándo se usaron por última
-- vez. Eso lo da `app.listar_secretos`, que no devuelve ni el valor ni el
-- identificador de Vault.

create table public.tenant_secrets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  nombre          text not null check (nombre ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  -- Identificador del secreto en Vault. El valor cifrado vive allí, no aquí.
  vault_secret_id uuid not null,
  descripcion     text,
  creado_por      uuid references auth.users(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  ultimo_uso_en   timestamptz,
  unique (tenant_id, nombre)
);

alter table public.tenant_secrets enable row level security;

-- Sin políticas y sin grants para `authenticated`. No es un olvido: es el
-- mecanismo. Si alguien añade una política aquí, el test de F1.7 falla.

create trigger tenant_secrets_actualizado_en before update on public.tenant_secrets
  for each row execute function app.tocar_actualizado_en();

-- ── Inventario, sin valores ──────────────────────────────────────────────────

create or replace function app.listar_secretos(p_tenant uuid)
returns table (
  nombre         text,
  descripcion    text,
  creado_en      timestamptz,
  actualizado_en timestamptz,
  ultimo_uso_en  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if not app.puede_administrar(p_tenant) then
    raise exception 'Solo un administrador del corporate ve el inventario de credenciales'
      using errcode = '42501';
  end if;

  return query
    select s.nombre, s.descripcion, s.creado_en, s.actualizado_en, s.ultimo_uso_en
    from public.tenant_secrets s
    where s.tenant_id = p_tenant
    order by s.nombre;
end
$$;

-- ── Guardar y leer el valor ──────────────────────────────────────────────────
-- Las dos funciones usan SQL dinámico para hablar con Vault. No es un capricho:
-- permite que la migración se aplique en un Postgres sin la extensión (las
-- pruebas usan uno embebido) y que el fallo, si Vault no está, sea un error
-- explícito en tiempo de ejecución en vez de una migración que no se puede
-- aplicar.
--
-- Lo que **no** hay es un camino alternativo en claro para cuando Vault falta.
-- Un secreto guardado sin cifrar «solo en desarrollo» es un secreto guardado
-- sin cifrar.

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
begin
  if to_regprocedure('vault.create_secret(text,text,text)') is null then
    raise exception
      'Supabase Vault no está disponible en esta base: un secreto de tenant no se guarda en claro'
      using errcode = '0A000';
  end if;

  if p_valor is null or length(p_valor) = 0 then
    raise exception 'Un secreto vacío no se guarda' using errcode = '22023';
  end if;

  select vault_secret_id into v_existente
  from public.tenant_secrets
  where tenant_id = p_tenant and nombre = p_nombre;

  if v_existente is null then
    execute 'select vault.create_secret($1, $2, $3)'
      into v_vault_id
      using p_valor, v_etiqueta, coalesce(p_descripcion, '');

    insert into public.tenant_secrets (tenant_id, nombre, vault_secret_id, descripcion, creado_por)
    values (p_tenant, p_nombre, v_vault_id, p_descripcion, (select auth.uid()));
  else
    execute 'select vault.update_secret($1, $2, $3, $4)'
      using v_existente, p_valor, v_etiqueta, coalesce(p_descripcion, '');

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

create or replace function app.leer_secreto(p_tenant uuid, p_nombre text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_vault_id uuid;
  v_valor    text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault no está disponible en esta base' using errcode = '0A000';
  end if;

  select vault_secret_id into v_vault_id
  from public.tenant_secrets
  where tenant_id = p_tenant and nombre = p_nombre;

  if v_vault_id is null then
    return null;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where id = $1'
    into v_valor
    using v_vault_id;

  update public.tenant_secrets
  set ultimo_uso_en = now()
  where tenant_id = p_tenant and nombre = p_nombre;

  return v_valor;
end
$$;

create or replace function app.borrar_secreto(p_tenant uuid, p_nombre text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_vault_id uuid;
begin
  select vault_secret_id into v_vault_id
  from public.tenant_secrets
  where tenant_id = p_tenant and nombre = p_nombre;

  if v_vault_id is null then
    return false;
  end if;

  delete from public.tenant_secrets where tenant_id = p_tenant and nombre = p_nombre;

  if to_regclass('vault.secrets') is not null then
    execute 'delete from vault.secrets where id = $1' using v_vault_id;
  end if;

  perform app.registrar_evento(
    p_tenant,
    'tenant.secret.deleted',
    jsonb_build_object('nombre', p_nombre),
    'sistema',
    'sistema'
  );

  return true;
end
$$;

-- ── Privilegios: aquí está la garantía ───────────────────────────────────────
-- `authenticated` puede pedir el inventario. No puede leer, escribir ni borrar
-- un valor: esas tres funciones solo las ejecuta `service_role`, que vive en el
-- servidor y nunca sale de `packages/db`.

revoke all on function app.guardar_secreto(uuid, text, text, text) from public;
revoke all on function app.leer_secreto(uuid, text) from public;
revoke all on function app.borrar_secreto(uuid, text) from public;
revoke all on function app.listar_secretos(uuid) from public;

grant execute on function app.listar_secretos(uuid) to authenticated, service_role;
grant execute on function app.guardar_secreto(uuid, text, text, text) to service_role;
grant execute on function app.leer_secreto(uuid, text) to service_role;
grant execute on function app.borrar_secreto(uuid, text) to service_role;
