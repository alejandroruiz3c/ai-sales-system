import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
  environment: process.env['NEXT_PUBLIC_SALES_OS_ENV'] ?? 'dev',
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
