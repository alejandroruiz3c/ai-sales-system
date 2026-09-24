'use server';

/**
 * Crear corporates, invitar personas y cambiar roles (F1.3, casos T1.1 y T1.2).
 *
 * Todas estas acciones consultan con `conRLS`, es decir con el rol
 * `authenticated` y la identidad del usuario. Eso significa que **las
 * comprobaciones de permiso de este fichero son redundantes por diseño**: si
 * una se me olvida, la política de la tabla rechaza igual. Están para dar un
 * mensaje entendible en vez de un error de Postgres, no para proteger.
 *
 * La excepción es la creación del usuario cuando alguien acepta una
 * invitación, que necesita la API de administración de Supabase Auth. Ese
 * camino está en `lib/supabase/admin.ts`, con su excepción de ESLint.
 */

import { createHash, randomBytes } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { activado, texto } from '../lib/formularios.ts';
import { env } from '../lib/env.ts';
import { COOKIE_TENANT, sesionActual, type Rol } from '../lib/sesion.ts';
import { slugDesdeNombre } from '../lib/slug.ts';
import type { ResultadoDeAccion } from './sesion.ts';

const ROLES_INVITABLES: readonly Rol[] = ['administrador', 'editor', 'lector'];
const DIAS_DE_VALIDEZ = 7;

function huella(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function crearCorporate(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion === undefined) redirect('/entrar');

  const nombre = texto(datos, 'nombre').trim();
  const zona = texto(datos, 'zona', 'Europe/Madrid');
  const idioma = texto(datos, 'idioma', 'es');
  const esDemo = activado(datos, 'esDemo');
  const presupuestoBruto = texto(datos, 'presupuesto').replace(',', '.');

  if (nombre.length < 2) return { error: 'El nombre del corporate es obligatorio.' };
  if (idioma !== 'es' && idioma !== 'en') return { error: 'El idioma tiene que ser es o en.' };

  const presupuesto =
    presupuestoBruto === '' ? Number(env.presupuestoPorDefecto ?? '0') : Number(presupuestoBruto);

  if (!Number.isFinite(presupuesto) || presupuesto < 0) {
    return { error: 'El presupuesto mensual tiene que ser un número de cero o más.' };
  }

  const slug = slugDesdeNombre(nombre);
  if (slug === '') return { error: 'De ese nombre no sale una dirección válida. Prueba otro.' };

  let tenantId: string;
  try {
    const fila = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
      ctx.unaFila<{ id: string }>(
        `select app.crear_tenant($1, $2, $3, $4, $5, $6::numeric) as id`,
        [nombre, slug, zona, idioma, esDemo, presupuesto],
      ),
    );
    if (fila === undefined) return { error: 'No se ha podido crear el corporate.' };
    tenantId = fila.id;
  } catch (error) {
    const mensaje = (error as Error).message;
    if (/duplicate key|unique/i.test(mensaje)) {
      return { error: `Ya existe un corporate con la dirección «${slug}». Cámbiale el nombre.` };
    }
    return { error: `No se ha podido crear el corporate: ${mensaje}` };
  }

  const almacen = await cookies();
  almacen.set(COOKIE_TENANT, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect('/panel');
}

export interface ResultadoDeInvitacion extends ResultadoDeAccion {
  /** El enlace que hay que hacer llegar a la persona invitada. */
  readonly enlace?: string;
}

/**
 * Invita a alguien a un corporate.
 *
 * Genera un token, guarda **solo su sha256** y devuelve el enlace para que
 * quien invita lo copie. No se manda ningún correo, y eso es una decisión, no
 * una carencia:
 *
 *   · en staging el interceptor de sandbox bloquea cualquier envío que no esté
 *     en la lista blanca, y falla cerrado (F0.15). Un correo de invitación que
 *     el sistema cree haber enviado y no haya salido es peor que no mandarlo;
 *   · una invitación que se copia y se pega funciona sin depender de SMTP, de
 *     la carpeta de spam ni del proveedor de correo del invitado. El envío
 *     automático llega en F4, cuando exista el adaptador de correo con su
 *     lista de supresión.
 */
export async function invitarPersona(
  _previo: ResultadoDeInvitacion,
  datos: FormData,
): Promise<ResultadoDeInvitacion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const email = texto(datos, 'email').trim().toLowerCase();
  const rol = texto(datos, 'rol', 'lector') as Rol;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: 'El correo no tiene buena pinta.' };
  if (!ROLES_INVITABLES.includes(rol)) {
    return { error: 'Solo se puede invitar como administrador, editor o lector.' };
  }

  const token = randomBytes(32).toString('base64url');
  const tenantId = sesion.tenant.id;

  try {
    await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
      await ctx.consultar(
        `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en, creada_por)
         values ($1, $2, $3, $4, now() + ($5 || ' days')::interval, auth.uid())`,
        [tenantId, email, rol, huella(token), String(DIAS_DE_VALIDEZ)],
      );
      await ctx.consultar(
        `select app.registrar_evento($1::uuid, 'membership.invited',
           jsonb_build_object('rol', $2::text), 'sistema', 'panel')`,
        [tenantId, rol],
      );
    });
  } catch (error) {
    const mensaje = (error as Error).message;
    if (mensaje.includes('invitaciones_pendiente_unica')) {
      return { error: 'Ya hay una invitación pendiente para ese correo en este corporate.' };
    }
    if (/row-level security/i.test(mensaje)) {
      return { error: 'Invitar a alguien exige ser administrador del corporate.' };
    }
    return { error: `No se ha podido crear la invitación: ${mensaje}` };
  }

  revalidatePath('/panel/equipo');
  const base = env.appUrl ?? '';
  return {
    ok: `Invitación creada para ${email}. Cópiale el enlace: caduca en ${String(DIAS_DE_VALIDEZ)} días.`,
    enlace: `${base}/invitacion/${token}`,
  };
}

export async function revocarInvitacion(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');
  const id = texto(datos, 'id');

  await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    await ctx.consultar(
      `update public.invitaciones set estado = 'revocada'
       where id = $1 and tenant_id = $2 and estado = 'pendiente'`,
      [id, sesion.tenant?.id],
    );
  });
  revalidatePath('/panel/equipo');
}

export async function cambiarRol(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');
  const usuarioId = texto(datos, 'usuarioId');
  const rol = texto(datos, 'rol');
  if (!['propietario', 'administrador', 'editor', 'lector'].includes(rol)) return;

  await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    await ctx.consultar(
      `update public.memberships set rol = $3
       where tenant_id = $1 and usuario_id = $2`,
      [sesion.tenant?.id, usuarioId, rol],
    );
    await ctx.consultar(
      `select app.registrar_evento($1::uuid, 'tenant.updated',
         jsonb_build_object('accion','cambio-de-rol','rol',$2::text), 'sistema', 'panel')`,
      [sesion.tenant?.id, rol],
    );
  });
  revalidatePath('/panel/equipo');
}

export async function quitarMiembro(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');
  const usuarioId = texto(datos, 'usuarioId');

  await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    await ctx.consultar(`delete from public.memberships where tenant_id = $1 and usuario_id = $2`, [
      sesion.tenant?.id,
      usuarioId,
    ]);
    await ctx.consultar(
      `select app.registrar_evento($1::uuid, 'membership.revoked', '{}'::jsonb, 'sistema', 'panel')`,
      [sesion.tenant?.id],
    );
  });
  revalidatePath('/panel/equipo');
}
