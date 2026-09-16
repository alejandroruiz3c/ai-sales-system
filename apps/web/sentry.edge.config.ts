import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? process.env['NEXT_PUBLIC_SENTRY_DSN'],
  environment: process.env['SALES_OS_ENV'] ?? process.env['VERCEL_ENV'] ?? 'dev',
  release: process.env['VERCEL_GIT_COMMIT_SHA'],
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
