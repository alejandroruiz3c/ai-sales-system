'use server';

/**
 * El primer arranque del sistema (caso T1.0).
 *
 * SALES OS nace vacío: sin corporates, sin usuarios y sin un solo dato de
 * negocio (regla permanente 3). Así que hace falta una puerta por la que entre
 * la primera persona, y esa puerta tiene dos condiciones:
 *
 * 1. **Solo existe mientras no hay nadie.** En cuanto hay un perfil, el
 *    asistente deja de estar disponible y la única forma de entrar es una
 *    invitación. Se comprueba contra la base en cada intento, no con una
 *    bandera.
 * 2. **Pide la contraseña de administrador de plataforma.** Staging es una URL
 *    pública: sin esto, el primero que pase por ahí se queda con el sistema.
 *
 * Se reutiliza `LAB_ACCESS_PASSWORD`, que Alex ya tiene, en vez de inventar un
 * secreto nuevo. Las dos cosas son lo mismo —la llave de quien **opera** SALES
 * OS, no de quien usa un corporate— y un secreto más que nadie recuerde dónde
 * está es el problema que F0 ya tuvo una vez.
 */

import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { texto } from '../lib/formularios.ts';
import { verifyLabPassword } from '../lib/lab-auth.ts';
import { crearUsuarioConfirmado } from '../lib/supabase/admin.ts';
import { clienteDeServidor } from '../lib/supabase/servidor.ts';
import type { ResultadoDeAccion } from './sesion.ts';

/** ¿Queda alguien en el sistema? Si no, el asistente de arranque está abierto. */
export async function sistemaVacio(): Promise<boolean> {
  const fila = await baseDeDatos().comoSistema(
    'Contar perfiles para saber si el asistente de primer arranque sigue abierto (T1.0)',
    (ctx) => ctx.unaFila<{ n: string }>('select count(*)::text as n from public.perfiles'),
  );
  return Number(fila?.n ?? '0') === 0;
}

export async function crearPrimerAdministrador(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const email = texto(datos, 'email').trim().toLowerCase();
  const nombre = texto(datos, 'nombre').trim();
  const contrasena = texto(datos, 'contrasena');
  const repetida = texto(datos, 'repetida');
  const llave = texto(datos, 'llave');

  if (!(await sistemaVacio())) {
    return {
      error:
        'El sistema ya tiene una persona dada de alta. El asistente de arranque solo existe mientras está vacío; a partir de ahí se entra por invitación.',
    };
  }
  if (!verifyLabPassword(llave)) {
    return { error: 'La contraseña de administrador de plataforma no es correcta.' };
  }
  if (nombre.length < 2) return { error: 'Escribe tu nombre.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: 'El correo no tiene buena pinta.' };
  if (contrasena.length < 12) {
    return { error: 'La contraseña tiene que tener al menos 12 caracteres.' };
  }
  if (contrasena !== repetida) return { error: 'Las dos contraseñas no coinciden.' };

  let usuarioId: string;
  try {
    const creado = await crearUsuarioConfirmado(email, contrasena, nombre);
    usuarioId = creado.id;
  } catch (error) {
    return { error: `No se pudo crear la cuenta: ${(error as Error).message}` };
  }

  // El trigger de `auth.users` ya ha creado el perfil. Aquí solo se marca como
  // administrador de plataforma, que es lo que ninguna sesión de usuario puede
  // hacer por sí misma: la columna no está en el `grant` de `authenticated`.
  await baseDeDatos().comoSistema(
    'Marcar al primer usuario como administrador de plataforma en el arranque (T1.0)',
    async (ctx) => {
      await ctx.consultar(
        `insert into public.perfiles (id, email, nombre, es_admin_plataforma)
         values ($1, $2, $3, true)
         on conflict (id) do update set es_admin_plataforma = true, nombre = excluded.nombre`,
        [usuarioId, email, nombre],
      );
    },
  );

  const supabase = await clienteDeServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: contrasena });
  if (error !== null) {
    return {
      error: 'La cuenta se ha creado, pero no se ha podido iniciar sesión. Entra en /entrar.',
    };
  }

  redirect('/panel/nuevo');
}
