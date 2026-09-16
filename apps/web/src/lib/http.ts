import { NextResponse } from 'next/server';

/**
 * Redirección con `Location` **relativo**.
 *
 * `NextResponse.redirect` exige una URL absoluta, y construirla con
 * `new URL(path, request.url)` usa el host que el servidor reconstruye, no el
 * que ha usado el cliente. Cuando no coinciden (`127.0.0.1` y `localhost`, o un
 * proxy delante), el navegador salta a otro origen y **descarta la cookie que
 * acabamos de poner**. Con `Location` relativo el origen no cambia nunca.
 */
export function redirectRelative(path: string, status: 302 | 303 | 307 = 303): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}

/** `true` si la petición ha llegado por HTTPS, mirando también el proxy. */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}
