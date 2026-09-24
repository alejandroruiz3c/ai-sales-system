import { NextResponse } from 'next/server';

import { checkLabAccess } from '@/lib/lab-guard.ts';
import { llamadaLlmDePrueba } from '@/lib/lab-pruebas.ts';

export const dynamic = 'force-dynamic';

/**
 * Caso T1.8 · una llamada LLM de prueba.
 *
 * No llama a ningún modelo —el router de `packages/llm` llega en F2— sino que
 * hace lo mismo que hará el router antes de llamar: pedirle permiso al
 * presupuesto y apuntar el gasto. Probar el corte sin gastar dinero es lo
 * correcto, y hace que el caso sea aritmética exacta.
 */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }

  const cuerpo: unknown = await peticion.json().catch(() => ({}));
  const tenantId =
    typeof cuerpo === 'object' && cuerpo !== null && 'tenantId' in cuerpo
      ? String(cuerpo.tenantId)
      : '';

  if (tenantId === '') {
    return NextResponse.json({ error: 'Falta el corporate de prueba.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await llamadaLlmDePrueba(tenantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 400 },
    );
  }
}
