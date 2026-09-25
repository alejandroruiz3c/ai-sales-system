import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Lo que comparten los E2E de F2: un corporate de prueba propio, creado y
 * borrado por el propio test, y las llamadas a las rutas de `/lab`.
 *
 * No se usa el reset general de la sala: borraría también los corporates de
 * prueba con los que alguien esté ejecutando el kit a mano. Cada test limpia
 * solo lo suyo.
 */

export const SELLO_F2 = `${String(Date.now())}${String(Math.floor(Math.random() * 1000))}`;

export interface ResultadoDePrueba {
  estado: 'valida' | 'texto' | 'fallida' | 'error' | 'bloqueada';
  modelo: string;
  nivel: string;
  costeEur: number;
  cacheAcertada: boolean;
  intentos: number;
  trazaId: string;
  uso: { entrada: number; salida: number; cacheEscrita: number; cacheLeida: number };
  datos?: Record<string, unknown>;
  errores?: string[];
  mensaje?: string;
  error?: string;
}

export async function crearCorporate(
  request: APIRequestContext,
  baseURL: string,
  nombre: string,
  presupuestoEur: number,
): Promise<string> {
  const respuesta = await request.post(`${baseURL}/api/lab/corporate-de-prueba`, {
    data: { nombre, presupuestoEur },
  });
  expect(respuesta.status(), await respuesta.text()).toBe(200);
  const { id } = (await respuesta.json()) as { id: string };
  return id;
}

export async function borrarCorporate(
  request: APIRequestContext,
  baseURL: string,
  tenantId: string,
): Promise<void> {
  await request.post(`${baseURL}/api/lab/corporate-de-prueba/borrar`, { data: { tenantId } });
}

export async function probar(
  request: APIRequestContext,
  baseURL: string,
  cuerpo: Record<string, unknown>,
): Promise<{ status: number; r: ResultadoDePrueba }> {
  const respuesta = await request.post(`${baseURL}/api/lab/probador`, {
    data: cuerpo,
    timeout: 90_000,
  });
  return { status: respuesta.status(), r: (await respuesta.json()) as ResultadoDePrueba };
}

/** El próximo enero desde hoy, como `AAAA-01`. */
export function proximoEnero(ahora = new Date()): string {
  return `${String(ahora.getFullYear() + 1)}-01`;
}
