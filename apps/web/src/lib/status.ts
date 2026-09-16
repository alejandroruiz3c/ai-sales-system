/**
 * Comprobación de los servicios de los que depende SALES OS (F0.11 y F0.14).
 *
 * Tres estados y una razón de ser para cada uno:
 * - `ok`              responde y las credenciales valen.
 * - `no-configurado`  falta una variable. No es un fallo: es trabajo pendiente,
 *                     y la ficha dice exactamente qué falta y dónde ponerlo.
 * - `error`           está configurado y no responde. Esto sí es un fallo.
 */

import { env } from './env.ts';

export type ServiceState = 'ok' | 'error' | 'no-configurado';

export interface ServiceCheck {
  readonly id: 'supabase' | 'inngest' | 'sentry' | 'langfuse';
  readonly name: string;
  readonly state: ServiceState;
  /** Qué se ha comprobado, o qué falta. Se muestra tal cual en `/status`. */
  readonly detail: string;
  /** Variables que faltan, si el estado es `no-configurado`. */
  readonly missing?: readonly string[];
  /** Dónde hay que configurarlo. */
  readonly where?: string;
  readonly latencyMs?: number;
}

const TIMEOUT_MS = 5000;

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response | null; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { response, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      response: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'error desconocido',
    };
  }
}

async function checkSupabase(): Promise<ServiceCheck> {
  const base = { id: 'supabase', name: 'Supabase' } as const;
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return {
      ...base,
      state: 'no-configurado',
      detail: 'Falta el proyecto de Supabase (región UE) de este entorno.',
      missing,
      where: 'Vercel → Settings → Environment Variables (y .env.local en desarrollo)',
    };
  }

  const { response, latencyMs, error } = await timedFetch(`${env.supabaseUrl}/auth/v1/health`, {
    headers: { apikey: env.supabaseAnonKey },
  });

  if (!response) {
    return { ...base, state: 'error', detail: `No responde: ${error ?? 'sin detalle'}`, latencyMs };
  }
  if (!response.ok) {
    return {
      ...base,
      state: 'error',
      detail: `Responde HTTP ${String(response.status)} en /auth/v1/health.`,
      latencyMs,
    };
  }
  return {
    ...base,
    state: 'ok',
    detail: `Proyecto accesible (${new URL(env.supabaseUrl).host}).`,
    latencyMs,
  };
}

async function checkInngest(): Promise<ServiceCheck> {
  const base = { id: 'inngest', name: 'Inngest' } as const;
  const missing: string[] = [];
  if (!env.inngestEventKey) missing.push('INNGEST_EVENT_KEY');
  if (!env.inngestSigningKey) missing.push('INNGEST_SIGNING_KEY');
  if (missing.length > 0) {
    return {
      ...base,
      state: 'no-configurado',
      detail:
        'Faltan las claves de Inngest de este entorno. Las funciones se sirven en /api/inngest, pero no hay a quién avisar.',
      missing,
      where: 'Vercel → Settings → Environment Variables (o la integración oficial de Inngest)',
    };
  }

  // La comprobación real es que el endpoint de introspección de nuestra propia
  // aplicación reconozca la clave de firma.
  const origin = env.appUrl ?? 'http://127.0.0.1:3000';
  const { response, latencyMs, error } = await timedFetch(`${origin}/api/inngest`);
  if (!response) {
    return {
      ...base,
      state: 'error',
      detail: `El endpoint /api/inngest no responde: ${error ?? 'sin detalle'}`,
      latencyMs,
    };
  }
  if (!response.ok) {
    return {
      ...base,
      state: 'error',
      detail: `El endpoint /api/inngest devuelve HTTP ${String(response.status)}.`,
      latencyMs,
    };
  }
  return {
    ...base,
    state: 'ok',
    detail: 'Claves presentes y endpoint /api/inngest sirviendo funciones.',
    latencyMs,
  };
}

function checkSentry(): ServiceCheck {
  const base = { id: 'sentry', name: 'Sentry' } as const;
  if (!env.sentryDsn) {
    return {
      ...base,
      state: 'no-configurado',
      detail: 'Falta el DSN, así que los errores no se están reportando a ningún sitio.',
      missing: ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'],
      where: 'Vercel → Settings → Environment Variables',
    };
  }
  try {
    const dsn = new URL(env.sentryDsn);
    if (dsn.username === '' || dsn.pathname === '/' || dsn.pathname === '') {
      return { ...base, state: 'error', detail: 'El DSN no tiene el formato esperado.' };
    }
    return {
      ...base,
      state: 'ok',
      detail: `DSN válido (${dsn.host}). Compruébalo de verdad con "Lanzar error de prueba".`,
    };
  } catch {
    return { ...base, state: 'error', detail: 'El DSN no es una URL válida.' };
  }
}

async function checkLangfuse(): Promise<ServiceCheck> {
  const base = { id: 'langfuse', name: 'Langfuse' } as const;
  const missing: string[] = [];
  if (!env.langfuseHost) missing.push('LANGFUSE_HOST');
  if (!env.langfusePublicKey) missing.push('LANGFUSE_PUBLIC_KEY');
  if (!env.langfuseSecretKey) missing.push('LANGFUSE_SECRET_KEY');
  if (!env.langfuseHost || !env.langfusePublicKey || !env.langfuseSecretKey) {
    return {
      ...base,
      state: 'no-configurado',
      detail:
        'Falta la instancia de Langfuse (región UE). Sin ella no hay trazas ni coste por tenant.',
      missing,
      where: 'Vercel → Settings → Environment Variables (y .env.local en desarrollo)',
    };
  }

  const credentials = Buffer.from(`${env.langfusePublicKey}:${env.langfuseSecretKey}`).toString(
    'base64',
  );
  const { response, latencyMs, error } = await timedFetch(
    `${env.langfuseHost.replace(/\/$/, '')}/api/public/health`,
    { headers: { Authorization: `Basic ${credentials}` } },
  );

  if (!response) {
    return { ...base, state: 'error', detail: `No responde: ${error ?? 'sin detalle'}`, latencyMs };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ...base,
      state: 'error',
      detail: 'Las claves no son válidas para esa instancia.',
      latencyMs,
    };
  }
  if (!response.ok) {
    return {
      ...base,
      state: 'error',
      detail: `Responde HTTP ${String(response.status)} en /api/public/health.`,
      latencyMs,
    };
  }
  return {
    ...base,
    state: 'ok',
    detail: `Instancia accesible (${new URL(env.langfuseHost).host}).`,
    latencyMs,
  };
}

export interface StatusReport {
  readonly generatedAt: string;
  readonly environment: string;
  readonly version: string;
  readonly sandbox: {
    readonly enabled: boolean;
    readonly allowlistSize: number;
    readonly ignoredDisableRequest: boolean;
  };
  readonly services: readonly ServiceCheck[];
  /** `true` si los cuatro servicios están en verde. */
  readonly allGreen: boolean;
}

export async function getStatusReport(): Promise<StatusReport> {
  const { getSandboxInterceptor } = await import('@sales-os/integrations/sandbox');
  const { appVersion } = await import('./env.ts');
  const sandbox = getSandboxInterceptor();

  const services = await Promise.all([
    checkSupabase(),
    checkInngest(),
    Promise.resolve(checkSentry()),
    checkLangfuse(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    environment: env.salesOsEnv,
    version: appVersion(),
    sandbox: {
      enabled: sandbox.config.enabled,
      allowlistSize: sandbox.rules.length,
      ignoredDisableRequest: sandbox.config.ignoredDisableRequest,
    },
    services,
    allGreen: services.every((service) => service.state === 'ok'),
  };
}
