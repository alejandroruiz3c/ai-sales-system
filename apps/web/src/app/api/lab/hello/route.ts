import { NextResponse } from 'next/server';

import { recordEvent } from '@/lib/events.ts';
import { inngest } from '@/lib/inngest/client.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

/** Lanza el evento de humo de F0.10 desde la sala de pruebas. */
export async function POST() {
  const access = await checkLabAccess();
  if (access !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });
  }

  const data = { tenantId: 'sistema', requestedBy: 'lab' } as const;

  recordEvent({
    kind: 'inngest',
    name: 'sales-os/hello.requested.v1',
    tenantId: data.tenantId,
    agent: 'sistema',
    message: 'Evento hello enviado a Inngest desde /lab.',
  });

  try {
    const result = await inngest.send({ name: 'sales-os/hello.requested.v1', data });
    return NextResponse.json({ sent: true, ids: result.ids });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido';
    recordEvent({
      kind: 'error',
      name: 'sales-os/hello.failed.v1',
      tenantId: data.tenantId,
      agent: 'sistema',
      message: `Inngest no ha aceptado el evento: ${message}`,
    });
    return NextResponse.json({ sent: false, error: message }, { status: 502 });
  }
}
