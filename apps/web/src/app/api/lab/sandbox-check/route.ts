import { getSandboxInterceptor, OUTBOUND_CHANNELS } from '@sales-os/integrations/sandbox';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordEvent } from '@/lib/events.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  channel: z.enum(OUTBOUND_CHANNELS),
  recipient: z.string().min(1).max(320),
  tenantId: z.string().min(1).max(64).default('sistema'),
  agent: z.string().min(1).max(64).default('lab'),
});

/**
 * Comprueba una decisión del interceptor de sandbox sin enviar nada (F0.15).
 *
 * Es el caso de prueba del kit de F0: se intenta un destinatario que no está en
 * la lista blanca y se comprueba que queda bloqueado con su motivo.
 */
export async function POST(request: Request) {
  const access = await checkLabAccess();
  if (access !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Petición inválida.', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const decision = getSandboxInterceptor().check(parsed.data);

  recordEvent({
    kind: 'sandbox',
    name: decision.allowed ? 'sandbox/envio.permitido.v1' : 'sandbox/envio.bloqueado.v1',
    tenantId: parsed.data.tenantId,
    agent: parsed.data.agent,
    message: decision.allowed
      ? `Permitido ${parsed.data.channel} → ${parsed.data.recipient} (${decision.via})`
      : decision.message,
    data: { channel: parsed.data.channel, recipient: parsed.data.recipient },
  });

  return NextResponse.json(
    decision.allowed
      ? {
          allowed: true,
          via: decision.via,
          matchedRule: decision.matchedRule ?? null,
        }
      : {
          allowed: false,
          reason: decision.reason,
          message: decision.message,
        },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
