/**
 * Sentry en el servidor (F0.11).
 *
 * Sin DSN, `Sentry.init` no hace nada: el sistema funciona igual y `/status`
 * muestra el servicio como "no configurado", que es la verdad.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'],
  environment: process.env['SALES_OS_ENV'] ?? process.env['VERCEL_ENV'] ?? 'dev',
  release: process.env['VERCEL_GIT_COMMIT_SHA'],
  // Muestreo bajo por defecto: el coste de las trazas no puede crecer con el
  // volumen de prospectos. Se ajusta cuando haya datos reales (F14.10).
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  // Los datos de un prospecto no son telemetría: no se mandan a Sentry.
  beforeSend(event) {
    if (event.request?.data !== undefined) delete event.request.data;
    if (event.request?.cookies !== undefined) delete event.request.cookies;
    return event;
  },
});
