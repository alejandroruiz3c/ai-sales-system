import { NextResponse } from 'next/server';

import { checkLabAccess } from '@/lib/lab-guard.ts';
import { ejecutarAgenteDePrueba } from '@/lib/lab-pruebas.ts';

export const dynamic = 'force-dynamic';

/**
 * Casos T1.7 y T1.9 · ejecuta el agente ficticio con la configuración real.
 *
 * En nivel L1 deja una aprobación de verdad en la cola (T1.7). En L0 genera la
 * acción y no la envía, y lo dice con su motivo (T1.9). Un botón que creara una
 * aprobación falsa probaría la cola y no probaría el nivel de autonomía.
 */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }

  const cuerpo: unknown = await peticion.json().catch(() => ({}));
  const leer = (campo: string): string =>
    typeof cuerpo === 'object' && cuerpo !== null && campo in cuerpo
      ? String((cuerpo as Record<string, unknown>)[campo])
      : '';

  const tenantId = leer('tenantId');
  if (tenantId === '') {
    return NextResponse.json({ error: 'Falta el corporate de prueba.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await ejecutarAgenteDePrueba(tenantId, leer('nota')));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 400 },
    );
  }
}
