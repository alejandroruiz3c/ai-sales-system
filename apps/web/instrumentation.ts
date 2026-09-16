import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    await import('./sentry.server.config.ts');
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('./sentry.edge.config.ts');
  }
}

/** Next llama a esto cuando una petición falla: así el error llega a Sentry. */
export const onRequestError = Sentry.captureRequestError;
