import 'server-only';

/**
 * Cliente de Supabase en el servidor, con la sesión en cookies.
 *
 * Igual que el del navegador, solo sirve para identidad. La diferencia es que
 * aquí sí se puede **verificar** quién es el usuario: `usuarioActual()` llama a
 * `getUser()`, que comprueba el token contra el servidor de auth, y no a
 * `getSession()`, que se limita a leer la cookie. La distinción importa: la
 * cookie la escribe el navegador, y de ella sale el `sub` con el que se abren
 * todas las consultas.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '../env.ts';

export async function clienteDeServidor() {
  const almacen = await cookies();
  if (env.supabaseUrl === undefined || env.supabaseAnonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (aEscribir) => {
        try {
          for (const { name, value, options } of aEscribir) {
            almacen.set(name, value, options);
          }
        } catch {
          // En un Server Component no se pueden escribir cookies. El refresco
          // lo hace el middleware, que sí puede, así que aquí no es un error.
        }
      },
    },
  });
}

export interface UsuarioActual {
  readonly id: string;
  readonly email: string;
}

/** Quién hace la petición, verificado contra el servidor de auth. */
export async function usuarioActual(): Promise<UsuarioActual | undefined> {
  const supabase = await clienteDeServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) return undefined;
  return { id: data.user.id, email: data.user.email ?? '' };
}
