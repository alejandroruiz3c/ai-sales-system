/**
 * Lectura de variables de entorno.
 *
 * Un único sitio donde se lee `process.env`, con dos motivos:
 * - el resto del código recibe valores ya normalizados y no tiene que decidir
 *   qué significa una cadena vacía;
 * - saber qué falta es un requisito de `/status`, que tiene que distinguir
 *   "roto" de "todavía no configurado".
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export const env = {
  salesOsEnv: read('SALES_OS_ENV') ?? read('VERCEL_ENV') ?? 'dev',
  appUrl: read('NEXT_PUBLIC_APP_URL'),
  appVersion: read('NEXT_PUBLIC_APP_VERSION'),
  commitSha: read('VERCEL_GIT_COMMIT_SHA'),
  commitRef: read('VERCEL_GIT_COMMIT_REF'),

  sandboxMode: read('SANDBOX_MODE'),
  sandboxAllowlist: read('SANDBOX_ALLOWLIST'),
  labPassword: read('LAB_ACCESS_PASSWORD'),

  supabaseUrl: read('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY'),

  inngestEventKey: read('INNGEST_EVENT_KEY'),
  inngestSigningKey: read('INNGEST_SIGNING_KEY'),

  sentryDsn: read('SENTRY_DSN') ?? read('NEXT_PUBLIC_SENTRY_DSN'),

  betterStackSourceToken: read('BETTER_STACK_SOURCE_TOKEN'),
  betterStackIngestingHost: read('BETTER_STACK_INGESTING_HOST'),

  langfuseHost: read('LANGFUSE_HOST'),
  langfusePublicKey: read('LANGFUSE_PUBLIC_KEY'),
  langfuseSecretKey: read('LANGFUSE_SECRET_KEY'),
} as const;

/** Versión visible en la página de inicio. En Vercel sale del commit desplegado. */
export function appVersion(): string {
  if (env.appVersion) return env.appVersion;
  if (env.commitSha) return `0.0.0+${env.commitSha.slice(0, 7)}`;
  return '0.0.0-local';
}
