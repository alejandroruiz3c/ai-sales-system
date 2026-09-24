-- 0003 · Archivos del tenant con versiones (F1.5, F1.6)
--
-- Dos tablas y no una, porque el caso T1.4 pide que al reemplazar un PDF la
-- versión anterior siga descargándose. Si la ruta de Storage viviera en la
-- tabla del archivo, reemplazar sería sobrescribir y el historial no existiría.
--
--   `tenant_files`          → el archivo como concepto: carpeta y nombre
--   `tenant_file_versions`  → cada subida, con su ruta en Storage y su sha256
--
-- Las versiones son append-only: una versión subida no cambia nunca. Lo que
-- cambia es cuál es la actual.
--
-- La ruta en Storage empieza siempre por el tenant (`{tenant_id}/{carpeta}/…`),
-- que es lo que permite que la política de `storage.objects` separe los
-- archivos por corporate igual que RLS separa las filas (ADR 0003, punto 5).

create table public.tenant_files (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  carpeta        text not null check (carpeta in ('context','inputs','outputs')),
  nombre         text not null check (
                   length(btrim(nombre)) between 1 and 200
                   -- Ni rutas ni travesía de directorios en un nombre de archivo.
                   and nombre !~ '[/\\]' and nombre <> '.' and nombre <> '..'
                 ),
  descripcion    text,
  version_actual integer not null default 0 check (version_actual >= 0),
  borrado_en     timestamptz,
  creado_por     uuid references auth.users(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index tenant_files_unico
  on public.tenant_files (tenant_id, carpeta, lower(nombre))
  where borrado_en is null;

create index tenant_files_tenant on public.tenant_files (tenant_id, carpeta);

alter table public.tenant_files enable row level security;

create policy tenant_files_lectura on public.tenant_files
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy tenant_files_insertar on public.tenant_files
  for insert to authenticated
  with check (app.puede_editar(tenant_id));

create policy tenant_files_actualizar on public.tenant_files
  for update to authenticated
  using (app.puede_editar(tenant_id))
  with check (app.puede_editar(tenant_id));

create policy tenant_files_borrar on public.tenant_files
  for delete to authenticated
  using (app.puede_administrar(tenant_id));

create trigger tenant_files_actualizado_en before update on public.tenant_files
  for each row execute function app.tocar_actualizado_en();

-- ── Versiones ────────────────────────────────────────────────────────────────

create table public.tenant_file_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  file_id      uuid not null references public.tenant_files(id) on delete cascade,
  version      integer not null check (version >= 1),
  ruta         text not null unique,
  tamano_bytes bigint not null check (tamano_bytes >= 0),
  mime         text not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  nota         text,
  subido_por   uuid references auth.users(id) on delete set null,
  creado_en    timestamptz not null default now(),
  unique (file_id, version)
);

create index tenant_file_versions_archivo
  on public.tenant_file_versions (file_id, version desc);

alter table public.tenant_file_versions enable row level security;

create policy tenant_file_versions_lectura on public.tenant_file_versions
  for select to authenticated
  using (app.es_miembro(tenant_id));

create policy tenant_file_versions_insertar on public.tenant_file_versions
  for insert to authenticated
  with check (app.puede_editar(tenant_id));

create trigger tenant_file_versions_append_only
  before update or delete on public.tenant_file_versions
  for each row execute function app.impedir_modificacion();

-- La ruta tiene que empezar por el tenant del archivo. Es la invariante que
-- hace que la política de Storage y RLS digan lo mismo; sin ella, una fila de
-- Aurora podría apuntar a un objeto de Logística Norte.
create or replace function app.validar_ruta_de_version()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_prefijo text;
  v_carpeta text;
begin
  select f.carpeta into v_carpeta from public.tenant_files f where f.id = new.file_id;
  v_prefijo := new.tenant_id::text || '/' || v_carpeta || '/';
  if position(v_prefijo in new.ruta) <> 1 then
    raise exception 'La ruta de una versión tiene que empezar por "%", y era "%"',
      v_prefijo, new.ruta
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger tenant_file_versions_ruta_valida
  before insert on public.tenant_file_versions
  for each row execute function app.validar_ruta_de_version();

-- ── Storage ──────────────────────────────────────────────────────────────────
-- Estas políticas solo se crean donde existe Supabase Storage. En las pruebas
-- con Postgres embebido no hay esquema `storage`, y saltarlas ahí es correcto:
-- lo que protege la descarga de un archivo es la ruta del panel, que comprueba
-- la pertenencia y firma una URL de vida corta. Esto es la segunda capa.

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin esquema storage: se omiten las políticas de objetos (entorno de prueba)';
    return;
  end if;

  if not exists (select 1 from storage.buckets where id = 'tenants') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('tenants', 'tenants', false, 52428800);
  end if;

  -- El bucket nunca es público: el primer segmento de la ruta es el tenant y la
  -- pertenencia se comprueba con la misma función que el resto del sistema.
  execute $pol$
    drop policy if exists tenants_objetos_lectura on storage.objects;
    create policy tenants_objetos_lectura on storage.objects
      for select to authenticated
      using (
        bucket_id = 'tenants'
        and app.es_miembro(nullif(split_part(name, '/', 1), '')::uuid)
      );
  $pol$;

  execute $pol$
    drop policy if exists tenants_objetos_escritura on storage.objects;
    create policy tenants_objetos_escritura on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'tenants'
        and app.puede_editar(nullif(split_part(name, '/', 1), '')::uuid)
        and split_part(name, '/', 2) in ('context','inputs','outputs')
      );
  $pol$;

  execute $pol$
    drop policy if exists tenants_objetos_borrado on storage.objects;
    create policy tenants_objetos_borrado on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'tenants'
        and app.puede_administrar(nullif(split_part(name, '/', 1), '')::uuid)
      );
  $pol$;
end
$$;

grant select, insert, update, delete on public.tenant_files to authenticated;
grant select, insert on public.tenant_file_versions to authenticated;
