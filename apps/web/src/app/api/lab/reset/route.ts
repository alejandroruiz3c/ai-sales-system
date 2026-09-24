import { NextResponse } from 'next/server';

import { env } from '@/lib/env.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';
import { resetDeLaSalaDePruebas } from '@/lib/lab-pruebas.ts';

export const dynamic = 'force-dynamic';

/**
 * «Reset tenant de pruebas» (plan §5B.2).
 *
 * Borra los corporates marcados de prueba y los usuarios cuyo correo empieza
 * por `e2e.`, y deja el sistema como recién instalado. Es lo que permite
 * repetir el kit completo y que los E2E corran contra staging sin dejar rastro.
 *
 * No existe en producción, y eso se comprueba aquí y otra vez dentro.
 */
export async function POST() {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  if (env.salesOsEnv === 'production') {
    return NextResponse.json(
      { error: 'El reset de la sala de pruebas no existe en producción.' },
      { status: 403 },
    );
  }

  try {
    return NextResponse.json(await resetDeLaSalaDePruebas(env.salesOsEnv));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 500 },
    );
  }
}
