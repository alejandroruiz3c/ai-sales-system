import 'server-only';

/**
 * Quién hace la petición, en qué corporate y con qué rol (F1.4).
 *
 * Es el punto por el que pasa toda página y toda ruta del panel. Resuelve tres
 * cosas y las deja disponibles juntas, porque separarlas invita a comprobar una
 * y olvidar otra:
 *
 *   · **usuario**, verificado contra el servidor de auth;
 *   · **corporate activo**, de la cookie, y validado contra las pertenencias
 *     reales del usuario. Una cookie manipulada con el uuid de otro corporate
 *     no sirve de nada: si no aparece en `tenantsDelUsuario`, se descarta;
 *   · **rol** en ese corporate, que es lo que decide qué puede hacer.
 *
 * El rol se usa para **decidir qué se enseña**. Lo que se puede hacer de verdad
 * lo decide RLS en la base: un `lector` que llame a la API con curl se topa con
 * la política, no con esta comprobación. Esto es la capa de servicio que el
 * ADR 0003 pide «además de RLS, no en su lugar».
 */

import { cookies } from 'next/headers';

import { baseDeDatos } from './base-de-datos.ts';
import type { Rol, TenantDelUsuario } from './roles.ts';
import { usuarioActual, type UsuarioActual } from './supabase/servidor.ts';

export const COOKIE_TENANT = 'sales_os_tenant';

export interface Sesion {
  readonly usuario: UsuarioActual;
  readonly nombre: string;
  readonly esAdminPlataforma: boolean;
  readonly tenants: readonly TenantDelUsuario[];
  /** El corporate activo, o `undefined` si el usuario no tiene ninguno. */
  readonly tenant?: TenantDelUsuario;
}

interface FilaDeTenant {
  id: string;
  nombre: string;
  slug: string;
  rol: Rol;
  es_demo: boolean;
}

interface FilaDePerfil {
  nombre: string | null;
  es_admin_plataforma: boolean;
}

/**
 * La sesión completa, o `undefined` si no hay usuario.
 *
 * Hace dos consultas y no una porque las dos van dentro de la misma transacción
 * con RLS aplicada: el perfil lo devuelve la política de `perfiles` y los
 * corporates la de `tenants`. Pedirlas juntas con un `join` daría lo mismo y se
 * leería peor.
 */
export async function sesionActual(): Promise<Sesion | undefined> {
  const usuario = await usuarioActual();
  if (usuario === undefined) return undefined;

  const almacen = await cookies();
  const tenantPedido = almacen.get(COOKIE_TENANT)?.value;

  const { perfil, tenants } = await baseDeDatos().conRLS(usuario.id, async (ctx) => ({
    perfil: await ctx.unaFila<FilaDePerfil>(
      'select nombre, es_admin_plataforma from public.perfiles where id = auth.uid()',
    ),
    tenants: await ctx.consultar<FilaDeTenant>(
      `select t.id, t.nombre, t.slug, m.rol, t.es_demo
       from public.tenants t
       join public.memberships m on m.tenant_id = t.id and m.usuario_id = auth.uid()
       where m.estado = 'activa' and t.estado <> 'archivado'
       order by t.nombre`,
    ),
  }));

  const lista: readonly TenantDelUsuario[] = tenants.map((f: FilaDeTenant) => ({
    id: f.id,
    nombre: f.nombre,
    slug: f.slug,
    rol: f.rol,
    esDemo: f.es_demo,
  }));

  // Una cookie con el uuid de un corporate al que no pertenece se descarta sin
  // ruido: `find` no lo encuentra y se cae al primero de su lista.
  const activo = lista.find((t) => t.id === tenantPedido) ?? lista[0];

  return {
    usuario,
    nombre: perfil?.nombre ?? usuario.email,
    esAdminPlataforma: perfil?.es_admin_plataforma ?? false,
    tenants: lista,
    ...(activo === undefined ? {} : { tenant: activo }),
  };
}

export {
  alMenos,
  DESCRIPCION_DE_ROL,
  ETIQUETA_DE_ROL,
  puedeAdministrar,
  puedeEditar,
  ROLES_DEL_PANEL,
  ROLES_INVITABLES,
  type Rol,
  type TenantDelUsuario,
} from './roles.ts';
