import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

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

/**
 * La respuesta de error de una ruta de `/lab`: 400 si la petición no valida,
 * 503 si falta configurar el proveedor de modelos, 400 con el mensaje en el
 * resto. Nunca un 500 con la traza: el caso T2.5 exige que un fallo «se marque
 * sin romper nada», y eso incluye la pantalla.
 */
export function errorDeLab(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const primero = error.issues[0];
    return NextResponse.json(
      { error: primero?.message ?? 'La petición no es válida.', campo: primero?.path.join('.') },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.name === 'ModelosNoConfigurados') {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'error desconocido' },
    { status: 400 },
  );
}
