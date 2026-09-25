import { NextResponse } from 'next/server';
import { z } from 'zod';

import { env } from '@/lib/env.ts';
import { errorDeLab } from '@/lib/http.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';
import { borrarCorporateDePrueba } from '@/lib/lab-pruebas.ts';

export const dynamic = 'force-dynamic';

const cuerpo = z.object({ tenantId: z.uuid() });

/** Borra un corporate de prueba concreto. Lo usan los E2E para limpiar solo lo suyo. */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  try {
    const { tenantId } = cuerpo.parse(await peticion.json());
    return NextResponse.json({ borrado: await borrarCorporateDePrueba(env.salesOsEnv, tenantId) });
  } catch (error) {
    return errorDeLab(error);
  }
}
