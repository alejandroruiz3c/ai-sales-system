import { NextResponse } from 'next/server';

import { checkLabAccess } from '@/lib/lab-guard.ts';
import { comprobarTraza, langfuseConfigurado } from '@/lib/llm.ts';

export const dynamic = 'force-dynamic';

/**
 * Caso T2.6 · qué tiene Langfuse de una traza: tenant, agente, coste y
 * generaciones. Para comprobarlo sin abrir Langfuse, y para el E2E.
 */
export async function GET(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }
  const id = new URL(peticion.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: 'Identificador de traza no válido.' }, { status: 400 });
  }
  if (!langfuseConfigurado()) {
    return NextResponse.json(
      { error: 'Langfuse no está configurado en este entorno.' },
      { status: 503 },
    );
  }
  return NextResponse.json(await comprobarTraza(id).catch(() => ({ existe: false })));
}
