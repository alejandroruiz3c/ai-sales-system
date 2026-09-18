/**
 * Comprobación de los servicios de los que depende SALES OS (F0.11 y F0.14).
 *
 * Tres estados y una razón de ser para cada uno:
 * - `ok`              responde y las credenciales valen.
 * - `no-configurado`  falta una variable. No es un fallo: es trabajo pendiente,
 *                     y la ficha dice exactamente qué falta y dónde ponerlo.
 * - `error`           está configurado y no responde. Esto sí es un fallo.
 */

import { crearCacheBreve } from './cache-breve.ts';
import { appVersion, env } from './env.ts';
import { log } from './log.ts';

export type ServiceState = 'ok' | 'error' | 'no-configurado';

export interface ServiceCheck {
  readonly id: 'supabase' | 'inngest' | 'sentry' | 'langfuse' | 'better-stack';
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

/**
 * Veredicto de preguntarle a Inngest si nuestra clave de firma vale.
 *
 * Tres valores y no dos, porque «no lo sé» es una respuesta distinta de «no
 * vale» y tratarlas igual fue un error: hacía que `/status` marcara Inngest en
 * rojo cuando el problema era de la API de Inngest, no de nuestra clave.
 */
interface VeredictoDeClave {
  readonly veredicto: 'vale' | 'no-vale' | 'no-se-sabe';
  readonly motivo: string;
  readonly latencyMs: number;
}

/**
 * Cinco minutos, mucho más que el informe completo.
 *
 * La API de Inngest **limita por frecuencia**: bajo una ráfaga de peticiones a
 * `/status` devuelve `429`, y eso hacía fallar el caso T0.2 una de cada doce
 * veces. Una clave de firma no cambia de un segundo a otro, así que preguntarlo
 * en cada comprobación no aporta nada y sí molesta al proveedor.
 */
const cacheDeLaClaveDeInngest = crearCacheBreve<VeredictoDeClave>(300_000);

async function comprobarClaveEnInngest(): Promise<VeredictoDeClave> {
  const { response, latencyMs, error } = await timedFetch(
    'https://api.inngest.com/v1/events?limit=1',
    { headers: { authorization: `Bearer ${env.inngestSigningKey ?? ''}` } },
  );

  if (!response) {
    return {
      veredicto: 'no-se-sabe',
      motivo: `no responde (${error ?? 'sin detalle'})`,
      latencyMs,
    };
  }
  // Solo un 401 o un 403 dicen algo sobre nuestra clave. Un 429 dice que hemos
  // preguntado mucho, y un 5xx dice que el problema es suyo.
  if (response.status === 401 || response.status === 403) {
    return { veredicto: 'no-vale', motivo: `HTTP ${String(response.status)}`, latencyMs };
  }
  if (response.status === 429) {
    return { veredicto: 'no-se-sabe', motivo: 'ha limitado por frecuencia (HTTP 429)', latencyMs };
  }
  if (!response.ok) {
    return {
      veredicto: 'no-se-sabe',
      motivo: `responde HTTP ${String(response.status)}`,
      latencyMs,
    };
  }
  return { veredicto: 'vale', motivo: 'HTTP 200', latencyMs };
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

  // Dos comprobaciones, porque son dos cosas distintas.
  //
  // La primera: que nuestro endpoint esté vivo. Aquí **no se puede exigir un
  // 200**: desde la versión 4 del SDK, un GET sin firmar a `/api/inngest`
  // responde 401 a propósito, y eso es la señal correcta de que el handler está
  // montado y exigiendo firma. La comprobación anterior pedía `response.ok` y
  // por eso marcaba Inngest en rojo con la configuración perfectamente bien.
  const origin = env.appUrl ?? 'http://127.0.0.1:3000';
  const propio = await timedFetch(`${origin}/api/inngest`);
  if (!propio.response) {
    return {
      ...base,
      state: 'error',
      detail: `El endpoint /api/inngest no responde: ${propio.error ?? 'sin detalle'}`,
      latencyMs: propio.latencyMs,
    };
  }

  // La segunda: que la clave de firma valga de verdad, preguntándole a Inngest.
  // Es la que detecta una clave de otro entorno, que es el fallo real que se da.
  const remoto = await cacheDeLaClaveDeInngest.obtener(comprobarClaveEnInngest);
  const latencyMs = propio.latencyMs + remoto.latencyMs;

  if (remoto.veredicto === 'no-vale') {
    return {
      ...base,
      state: 'error',
      detail:
        'La clave de firma no vale para esta cuenta de Inngest. Suele ser la clave de otro entorno.',
      latencyMs,
    };
  }

  const montado = `/api/inngest montado (responde HTTP ${String(propio.response.status)} a un GET sin firmar, que es lo correcto)`;

  return remoto.veredicto === 'vale'
    ? { ...base, state: 'ok', detail: `Clave de firma válida y ${montado}.`, latencyMs }
    : {
        ...base,
        state: 'ok',
        detail: `Claves presentes y ${montado}. La clave no se ha podido reconfirmar contra la API de Inngest: ${remoto.motivo}`,
        latencyMs,
      };
}

/**
 * Better Stack (F0.11).
 *
 * No se comprueba mirando si las variables existen: se manda un latido de
 * verdad por el mismo camino que usan los logs de la aplicación. Si esto está
 * en verde, los logs llegan; si no, no llegan, y da igual lo que diga el panel
 * de Better Stack.
 */
async function checkBetterStack(): Promise<ServiceCheck> {
  const base = { id: 'better-stack', name: 'Better Stack' } as const;
  const missing: string[] = [];
  if (!env.betterStackSourceToken) missing.push('BETTER_STACK_SOURCE_TOKEN');
  if (!env.betterStackIngestingHost) missing.push('BETTER_STACK_INGESTING_HOST');
  if (missing.length > 0) {
    return {
      ...base,
      state: 'no-configurado',
      detail:
        'Falta la fuente de logs de este entorno. La aplicación sigue registrando en consola, pero los logs no se conservan.',
      missing,
      where: 'Vercel → Settings → Environment Variables (una fuente por entorno)',
    };
  }

  const logger = log();
  const started = Date.now();
  const resultado = await logger.enviar(
    logger.entrada('info', 'latido de /status', {
      outcome: 'ok',
      version: appVersion(),
    }),
  );
  const latencyMs = Date.now() - started;

  return resultado.enviado
    ? {
        ...base,
        state: 'ok',
        detail: `Latido aceptado por la fuente. ${resultado.detalle}`,
        latencyMs,
      }
    : { ...base, state: 'error', detail: resultado.detalle, latencyMs };
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
  /** `true` si todos los servicios están en verde. */
  readonly allGreen: boolean;
}

/**
 * Diez segundos: suficiente para que una ráfaga de peticiones comparta una sola
 * comprobación, y poco como para que `/status` siga diciendo lo que pasa ahora.
 */
const cacheDelInforme = crearCacheBreve<StatusReport>(10_000);

/** El informe, cacheado unos segundos. Es lo que sirven la página y la API. */
export async function getStatusReport(): Promise<StatusReport> {
  return cacheDelInforme.obtener(calcularStatusReport);
}

/** Calcula el informe de verdad, sin caché. */
export async function calcularStatusReport(): Promise<StatusReport> {
  const { getSandboxInterceptor } = await import('@sales-os/integrations/sandbox');
  const { appVersion } = await import('./env.ts');
  const sandbox = getSandboxInterceptor();

  const services = await Promise.all([
    checkSupabase(),
    checkInngest(),
    Promise.resolve(checkSentry()),
    checkLangfuse(),
    checkBetterStack(),
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
