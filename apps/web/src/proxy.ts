/**
 * Refresco de sesión y protección de rutas (F1.4).
 *
 * Se llama `proxy` y no `middleware` porque es la convención de Next 16: el
 * nombre antiguo sigue funcionando y avisa de que está en desuso. Es
 * exactamente el mismo concepto, ejecutándose antes de cualquier ruta.
 *
 * Hace dos cosas, y solo dos:
 *
 * 1. **Refresca el token de Supabase** y reescribe las cookies. Tiene que
 *    pasar aquí porque un Server Component no puede escribir cookies: si no se
 *    hiciera, la sesión caducaría a la hora y el usuario vería «entra de
 *    nuevo» sin haber hecho nada.
 * 2. **Deja pasar o manda a la puerta.** Nada más. El middleware no decide
 *    permisos por rol ni consulta la base: mira si hay sesión y poco más.
 *
 * Que no decida permisos es deliberado. El middleware corre antes que todo y
 * es tentador convertirlo en el sitio donde vive la autorización, pero
 * entonces la autorización dependería de acertar con los `matcher`, y un
 * `matcher` mal escrito es un agujero silencioso. Quien decide qué puede hacer
 * cada rol es **RLS en la base** (ADR 0003); las páginas comprueban el rol para
 * decidir qué enseñar, no para proteger.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Rutas que existen sin sesión. Todo lo demás bajo `/panel` exige entrar. */
const PUBLICAS = ['/', '/entrar', '/bienvenida', '/status', '/invitacion'];

export async function proxy(peticion: NextRequest) {
  let respuesta = NextResponse.next({ request: peticion });

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  // Sin Supabase configurado no hay sesión que refrescar. Se deja pasar: el
  // panel dirá qué falta con un mensaje, que es más útil que un 500.
  if (url === undefined || anon === undefined) return respuesta;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => peticion.cookies.getAll(),
      setAll: (aEscribir) => {
        for (const { name, value } of aEscribir) peticion.cookies.set(name, value);
        respuesta = NextResponse.next({ request: peticion });
        for (const { name, value, options } of aEscribir) {
          respuesta.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()` y no `getSession()`: el primero valida el token contra el
  // servidor de auth, el segundo se limita a leer la cookie que escribió el
  // navegador.
  const { data } = await supabase.auth.getUser();
  const ruta = peticion.nextUrl.pathname;

  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (data.user === null && !esPublica && !ruta.startsWith('/lab')) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = '/entrar';
    // Para volver donde estaba después de entrar.
    destino.searchParams.set('volver', ruta);
    return NextResponse.redirect(destino);
  }

  if (data.user !== null && (ruta === '/entrar' || ruta === '/bienvenida')) {
    const destino = peticion.nextUrl.clone();
    destino.pathname = '/panel';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return respuesta;
}

export const config = {
  matcher: [
    // Todo menos los estáticos de Next, los recursos y las rutas de API, que
    // se protegen ellas mismas comprobando la sesión en el servidor.
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
