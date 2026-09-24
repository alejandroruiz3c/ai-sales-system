'use server';

/**
 * Aceptar una invitación (F1.3, caso T1.2).
 *
 * Dos caminos según si el correo invitado ya tiene cuenta:
 *
 *   · **no la tiene:** se crea con la contraseña que elija, ya confirmada. La
 *     confirmación del correo ya ocurrió por otra vía: el token del enlace solo
 *     lo conoce quien lo recibió;
 *   · **sí la tiene:** se le pide entrar y al volver se acepta sola.
 *
 * Lo que decide si la invitación vale es `app.aceptar_invitacion`, en la base,
 * que comprueba el estado, la caducidad y —lo importante— que **el correo de la
 * invitación sea el del usuario que la acepta**. Sin eso, un enlace reenviado
 * por error daría acceso a quien lo recibiera.
 */

import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { texto } from '../lib/formularios.ts';
import { COOKIE_TENANT } from '../lib/sesion.ts';
import { buscarUsuarioPorEmail, crearUsuarioConfirmado } from '../lib/supabase/admin.ts';
import { clienteDeServidor, usuarioActual } from '../lib/supabase/servidor.ts';
import type { ResultadoDeAccion } from './sesion.ts';

function huella(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface InvitacionVisible {
  readonly estado: 'valida' | 'caducada' | 'usada' | 'desconocida';
  readonly email?: string;
  readonly rol?: string;
  readonly corporate?: string;
  readonly yaTieneCuenta?: boolean;
}

/**
 * Lee la invitación para pintar la página.
 *
 * Va por `comoSistema` porque quien abre el enlace **todavía no es miembro de
 * nada**: con `conRLS` la política de `invitaciones` no le devolvería la fila.
 * Lo que se enseña se limita a lo que quien tiene el token ya sabe (su propio
 * correo) más el nombre del corporate, y nada más: ni quién invita, ni quién
 * más hay dentro.
 */
export async function leerInvitacion(token: string): Promise<InvitacionVisible> {
  const fila = await baseDeDatos().comoSistema(
    'Leer una invitación por su token: quien abre el enlace no es miembro de ningún corporate todavía',
    (ctx) =>
      ctx.unaFila<{
        email: string;
        rol: string;
        estado: string;
        vencida: boolean;
        corporate: string;
      }>(
        `select i.email, i.rol, i.estado, i.expira_en < now() as vencida, t.nombre as corporate
         from public.invitaciones i join public.tenants t on t.id = i.tenant_id
         where i.token_hash = $1`,
        [huella(token)],
      ),
  );

  if (fila === undefined) return { estado: 'desconocida' };
  if (fila.estado !== 'pendiente') {
    return { estado: 'usada', email: fila.email, corporate: fila.corporate };
  }
  if (fila.vencida) return { estado: 'caducada', email: fila.email, corporate: fila.corporate };

  const existente = await buscarUsuarioPorEmail(fila.email).catch(() => undefined);

  return {
    estado: 'valida',
    email: fila.email,
    rol: fila.rol,
    corporate: fila.corporate,
    yaTieneCuenta: existente !== undefined,
  };
}

async function aceptarConSesion(usuarioId: string, token: string): Promise<string> {
  const fila = await baseDeDatos().conRLS(usuarioId, (ctx) =>
    ctx.unaFila<{ id: string }>('select app.aceptar_invitacion($1) as id', [huella(token)]),
  );
  if (fila === undefined) throw new Error('La invitación no se ha podido aceptar');
  return fila.id;
}

export async function aceptarInvitacion(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const token = texto(datos, 'token');
  const nombre = texto(datos, 'nombre').trim();
  const contrasena = texto(datos, 'contrasena');
  const repetida = texto(datos, 'repetida');

  const invitacion = await leerInvitacion(token);
  if (invitacion.estado !== 'valida' || invitacion.email === undefined) {
    return { error: 'Esta invitación ya no es válida.' };
  }

  const yaEntrado = await usuarioActual();
  let usuarioId: string;

  if (yaEntrado !== undefined) {
    if (yaEntrado.email.toLowerCase() !== invitacion.email.toLowerCase()) {
      return {
        error: `Esta invitación es para ${invitacion.email} y has entrado como ${yaEntrado.email}. Sal de la sesión y vuelve a abrir el enlace.`,
      };
    }
    usuarioId = yaEntrado.id;
  } else if (invitacion.yaTieneCuenta === true) {
    return { error: 'Ya tienes cuenta: entra primero y vuelve a abrir este enlace.' };
  } else {
    if (nombre.length < 2) return { error: 'Escribe tu nombre.' };
    if (contrasena.length < 12) {
      return { error: 'La contraseña tiene que tener al menos 12 caracteres.' };
    }
    if (contrasena !== repetida) return { error: 'Las dos contraseñas no coinciden.' };

    try {
      const creado = await crearUsuarioConfirmado(invitacion.email, contrasena, nombre);
      usuarioId = creado.id;
    } catch (error) {
      return { error: `No se pudo crear la cuenta: ${(error as Error).message}` };
    }

    const supabase = await clienteDeServidor();
    const { error } = await supabase.auth.signInWithPassword({
      email: invitacion.email,
      password: contrasena,
    });
    if (error !== null) {
      return { error: 'La cuenta se ha creado. Entra en /entrar y vuelve a abrir el enlace.' };
    }
  }

  let tenantId: string;
  try {
    tenantId = await aceptarConSesion(usuarioId, token);
  } catch (error) {
    return { error: `No se ha podido aceptar la invitación: ${(error as Error).message}` };
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
