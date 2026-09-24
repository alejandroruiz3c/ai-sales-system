import 'server-only';

/**
 * El único sitio del panel que usa la `service_role`.
 *
 * Existe una regla de ESLint que prohíbe leer `SUPABASE_SERVICE_ROLE_KEY` fuera
 * de `packages/db` (ADR 0003), y este fichero es su única excepción, declarada
 * en `eslint.config.mjs` por ruta. Está escrita así —con el acceso literal a
 * `process.env['SUPABASE_SERVICE_ROLE_KEY']`, en vez de por `env.ts`— a
 * propósito: si se leyera con un nombre calculado, la regla no lo vería y la
 * excepción dejaría de ser visible en la revisión. (El selector de la regla se
 * amplió en este mismo PR para reconocer la forma con corchetes, que es la que
 * `noPropertyAccessFromIndexSignature` obliga a escribir.)
 *
 * Y se limita a lo que de verdad no se puede hacer de otra forma: **la API de
 * administración de Supabase Auth**, que es la que crea un usuario cuando
 * alguien acepta una invitación. Los datos no pasan por aquí; para eso está
 * `comoSistema` en `packages/db`, que también exige un motivo por escrito.
 *
 * Lo que no hace este cliente, y no es casualidad:
 *
 *   · no consulta tablas de `public`;
 *   · no se exporta el cliente entero, solo dos operaciones concretas;
 *   · nunca se llama desde un componente de cliente.
 */

import { createClient } from '@supabase/supabase-js';

import { env } from '../env.ts';

function clienteAdmin() {
  const clave = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (env.supabaseUrl === undefined || clave === undefined || clave.trim() === '') {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL: sin ellas no se pueden dar de alta usuarios.',
    );
  }
  return createClient(env.supabaseUrl, clave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface UsuarioCreado {
  readonly id: string;
  readonly email: string;
}

/**
 * Da de alta un usuario con su contraseña, ya confirmado.
 *
 * Se confirma el correo directamente porque **la confirmación ya ocurrió por
 * otro camino**: o bien es la primera persona del sistema, que ha tenido que
 * poner la contraseña de administrador de plataforma, o bien viene de un enlace
 * de invitación cuyo token solo conoce quien lo recibió. Mandar además un
 * correo de confirmación añadiría una dependencia de SMTP a un flujo que ya
 * está autenticado por otra vía, y en staging el interceptor de sandbox la
 * bloquearía.
 */
export async function crearUsuarioConfirmado(
  email: string,
  contrasena: string,
  nombre: string,
): Promise<UsuarioCreado> {
  const { data, error } = await clienteAdmin().auth.admin.createUser({
    email,
    password: contrasena,
    email_confirm: true,
    user_metadata: { nombre },
  });

  if (error !== null) throw new Error(error.message);
  return { id: data.user.id, email: data.user.email ?? email };
}

/** Busca un usuario por correo. Devuelve `undefined` si no existe. */
export async function buscarUsuarioPorEmail(email: string): Promise<UsuarioCreado | undefined> {
  const { data, error } = await clienteAdmin().auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error !== null) throw new Error(error.message);
  const encontrado = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  return encontrado === undefined
    ? undefined
    : { id: encontrado.id, email: encontrado.email ?? email };
}
