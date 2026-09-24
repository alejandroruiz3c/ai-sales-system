'use client';

/**
 * Cliente de Supabase para el navegador.
 *
 * Solo se usa para **identidad**: iniciar sesión, cerrarla y refrescar el token.
 * Los datos no pasan por aquí: los lee el servidor con `conRLS`, que abre una
 * transacción con el rol `authenticated` y la identidad verificada del usuario.
 *
 * El motivo de separarlo así es que el aislamiento entre corporates dependa de
 * un solo mecanismo. Si el navegador consultase directamente, habría dos
 * caminos a los datos —PostgREST y nuestra capa— y dos sitios donde puede
 * fallar el mismo razonamiento.
 */

import { createBrowserClient } from '@supabase/ssr';

export function clienteDeNavegador() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (url === undefined || anon === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createBrowserClient(url, anon);
}
