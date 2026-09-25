import { NextResponse } from 'next/server';

import { errorDeLab } from '@/lib/http.ts';
import { probarModelo } from '@/lib/lab-modelos.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

/**
 * Probador de modelos (F2, casos T2.1, T2.2, T2.3 y T2.5).
 *
 * Una llamada de verdad al router, contra el presupuesto de un corporate de
 * prueba. Devuelve lo que el plan pide ver: modelo elegido, coste, si hubo
 * acierto de caché, cuántos intentos hicieron falta y el enlace a la traza.
 */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  try {
    return NextResponse.json(await probarModelo(await peticion.json()));
  } catch (error) {
    return errorDeLab(error);
  }
}
