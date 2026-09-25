import { NextResponse } from 'next/server';
import { z } from 'zod';

import { errorDeLab } from '@/lib/http.ts';
import { lanzarLoteT24 } from '@/lib/lab-modelos.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

const cuerpo = z.object({ tenantId: z.uuid({ error: 'Elige un corporate de prueba.' }) });

/**
 * Caso T2.4 · lanza en modo lote la clasificación de las 20 respuestas del
 * fichero de prueba. Vuelve en cuanto el lote está creado; lo recoge Inngest.
 */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  try {
    const { tenantId } = cuerpo.parse(await peticion.json());
    return NextResponse.json(await lanzarLoteT24(tenantId));
  } catch (error) {
    return errorDeLab(error);
  }
}
