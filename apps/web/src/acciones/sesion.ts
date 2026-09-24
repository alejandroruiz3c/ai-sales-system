'use server';

/**
 * Entrar, salir y cambiar de corporate (F1.3).
 *
 * Todo lo que escribe cookies o crea usuarios pasa por aquí, en el servidor.
 * El navegador solo manda el formulario.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { texto } from '../lib/formularios.ts';
import { COOKIE_TENANT, sesionActual } from '../lib/sesion.ts';
import { clienteDeServidor } from '../lib/supabase/servidor.ts';

export interface ResultadoDeAccion {
  readonly error?: string;
  readonly ok?: string;
}

const UN_ANO = 60 * 60 * 24 * 365;

export async function entrar(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const email = texto(datos, 'email').trim();
  const contrasena = texto(datos, 'contrasena');
  const volver = texto(datos, 'volver', '/panel');

  if (email === '' || contrasena === '') {
    return { error: 'Hacen falta el correo y la contraseña.' };
  }

  const supabase = await clienteDeServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: contrasena });

  if (error !== null) {
    // Mismo mensaje para «no existe» y «contraseña mal», a propósito: si
    // fueran distintos, este formulario serviría para averiguar quién tiene
    // cuenta en el sistema.
    return { error: 'El correo o la contraseña no son correctos.' };
  }

  redirect(volver.startsWith('/') ? volver : '/panel');
}

export async function salir(): Promise<never> {
  const supabase = await clienteDeServidor();
  await supabase.auth.signOut();
  const almacen = await cookies();
  almacen.delete(COOKIE_TENANT);
  redirect('/entrar');
}

/**
 * Cambia el corporate activo.
 *
 * Comprueba la pertenencia **antes** de escribir la cookie, y la comprueba
 * consultando con RLS: si el usuario no es miembro, la consulta no devuelve la
 * fila y la cookie no se escribe. Aun así la cookie no es la autoridad —
 * `sesionActual()` la vuelve a validar en cada petición—, pero equivocarse
 * aquí daría un panel en blanco desconcertante en vez de un error.
 */
export async function cambiarDeTenant(datos: FormData): Promise<void> {
  const tenantId = texto(datos, 'tenantId');
  const sesion = await sesionActual();
  if (sesion === undefined) redirect('/entrar');

  if (!sesion.tenants.some((t) => t.id === tenantId)) return;

  const almacen = await cookies();
  almacen.set(COOKIE_TENANT, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: UN_ANO,
  });

  await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    await ctx.consultar(
      `select app.registrar_evento($1::uuid, 'tenant.updated', jsonb_build_object('accion','cambio-de-corporate'), 'sistema', 'panel')`,
      [tenantId],
    );
  });

  redirect('/panel');
}
