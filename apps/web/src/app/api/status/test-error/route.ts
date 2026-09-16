import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env.ts';
import { recordEvent } from '@/lib/events.ts';

export const dynamic = 'force-dynamic';

/**
 * Lanza un error real en el servidor y lo reporta a Sentry (caso T0.6).
 *
 * No devuelve 500: el objetivo es comprobar que Sentry recibe el error, no
 * ensuciar las métricas de disponibilidad con un fallo provocado.
 */
export async function POST() {
  const error = new Error('Error de prueba de SALES OS (F0.11) lanzado desde /status');
  error.name = 'SalesOsTestError';

  const reported = env.sentryDsn !== undefined;
  const eventId = reported
    ? Sentry.captureException(error, {
        tags: { fase: 'F0', origen: 'status-test-error' },
        level: 'error',
      })
    : undefined;

  if (reported) await Sentry.flush(2000);

  recordEvent({
    kind: 'error',
    name: 'sistema/error.prueba.v1',
    tenantId: 'sistema',
    agent: 'sistema',
    message: reported
      ? 'Error de prueba lanzado y enviado a Sentry.'
      : 'Error de prueba lanzado; Sentry no está configurado en este entorno.',
    ...(eventId ? { data: { eventId } } : {}),
  });

  return NextResponse.json(
    { reported, eventId: eventId ?? null, message: error.message },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
