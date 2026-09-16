import { cookies } from 'next/headers';

import { isLabConfigured, LAB_COOKIE, verifyLabToken } from './lab-auth.ts';

export type LabAccess = 'autorizado' | 'sin-sesion' | 'no-habilitado';

/**
 * Decide si quien pide puede entrar en `/lab`.
 *
 * Si `LAB_ACCESS_PASSWORD` no está configurada, la respuesta es `no-habilitado`
 * y la sala no existe: un panel de administración sin protección es peor que no
 * tenerlo.
 */
export async function checkLabAccess(): Promise<LabAccess> {
  if (!isLabConfigured()) return 'no-habilitado';
  const jar = await cookies();
  return verifyLabToken(jar.get(LAB_COOKIE)?.value) ? 'autorizado' : 'sin-sesion';
}
