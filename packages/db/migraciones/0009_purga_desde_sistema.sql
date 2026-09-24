-- 0009 · La purga de un corporate de prueba también desde el sistema
--
-- `app.purgar_tenant_demo` exigía ser propietario del corporate o administrador
-- de plataforma, y las dos comprobaciones se apoyan en `auth.uid()`. Con el rol
-- `service_role` no hay sesión, así que `auth.uid()` es null y la función
-- rechazaba. Eso deja sin camino al botón «Reset tenant de pruebas» de `/lab`
-- cuando el reseteo tiene que hacer algo más que borrar filas (borrar también
-- el usuario de `auth.users`, por ejemplo), que es un trabajo de sistema.
--
-- Se añade el tercer caso, y conviene ser exacto sobre qué protege qué, porque
-- aquí es fácil creerse más seguro de lo que se es:
--
--   · **La guarda que de verdad protege es `es_demo`.** Un corporate real no se
--     borra desde esta función ni con la llave maestra; hay que hacerlo a mano
--     en la base, que es exactamente la fricción que tiene que tener.
--   · **La comprobación del rol es defensa contra una equivocación, no contra
--     un atacante.** Se lee con `current_setting('role', true)` y no con
--     `current_user`, porque dentro de una función `security definer`
--     `current_user` es el propietario de la función, no quien la llama. Y esa
--     variable la puede cambiar cualquiera que ya pueda ejecutar SQL arbitrario
--     en la conexión, que es alguien que podría borrar la fila directamente sin
--     pasar por aquí. Sirve para distinguir nuestros dos caminos de código
--     —`conRLS` y `comoSistema`—, no para detener a nadie.

create or replace function app.purgar_tenant_demo(p_tenant uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_es_demo boolean;
  v_nombre  text;
  v_sistema boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  select es_demo, nombre into v_es_demo, v_nombre
  from public.tenants where id = p_tenant;

  if v_es_demo is null then
    return false;
  end if;

  -- Primero la condición sobre el dato, y después la de quién pregunta: si el
  -- corporate no es de prueba, da igual quién sea quien llama.
  if not v_es_demo then
    raise exception
      'Solo se pueden borrar corporates de prueba. "%" no está marcado como demo.', v_nombre
      using errcode = '42501';
  end if;

  if not (
    v_sistema
    or app.tiene_rol(p_tenant, variadic array['propietario'])
    or app.es_admin_plataforma()
  ) then
    raise exception 'Borrar un corporate exige ser su propietario o administrador de plataforma'
      using errcode = '42501';
  end if;

  perform set_config('app.purga_de_tenant', 'on', true);
  delete from public.tenants where id = p_tenant;
  perform set_config('app.purga_de_tenant', 'off', true);

  return true;
end
$$;

revoke all on function app.purgar_tenant_demo(uuid) from public, anon;
grant execute on function app.purgar_tenant_demo(uuid) to authenticated, service_role;
