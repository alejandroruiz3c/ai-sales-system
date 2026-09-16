/**
 * Interceptor de modo sandbox (F0.15).
 *
 * Tres reglas, y las tres importan:
 *
 * 1. **Falla cerrado.** Si no hay configuración, si la lista blanca está vacía o
 *    si el destinatario no se puede interpretar, se bloquea.
 * 2. **No se puede desactivar fuera de producción.** Poner `SANDBOX_MODE=off` en
 *    staging no desactiva nada: se ignora y queda constancia. El plan exige que
 *    en staging sea *técnicamente imposible* escribir a un prospecto real
 *    (§5B.2), y una variable de entorno que alguien puede cambiar no es una
 *    imposibilidad técnica.
 * 3. **Toda decisión es auditable.** Devuelve un objeto con el intento, el
 *    motivo y la regla que ha coincidido, para registrarlo como evento.
 */

import {
  type AllowlistRule,
  matchesAllowlist,
  parseAllowlist,
  splitAllowlistValue,
} from './allowlist.ts';
import {
  type OutboundAttempt,
  type SalesOsEnv,
  SALES_OS_ENVS,
  type SandboxConfig,
  type SandboxDecision,
} from './types.ts';

/** Error que lanza `assertOutboundAllowed` cuando el sandbox bloquea un envío. */
export class SandboxBlockedError extends Error {
  readonly decision: SandboxDecision & { allowed: false };

  constructor(decision: SandboxDecision & { allowed: false }) {
    super(decision.message);
    this.name = 'SandboxBlockedError';
    this.decision = decision;
  }
}

export interface SandboxEnvSource {
  readonly SALES_OS_ENV?: string | undefined;
  readonly SANDBOX_MODE?: string | undefined;
  readonly SANDBOX_ALLOWLIST?: string | undefined;
}

function parseEnv(value: string | undefined): SalesOsEnv {
  const normalized = (value ?? '').trim().toLowerCase();
  const found = SALES_OS_ENVS.find((candidate) => candidate === normalized);
  // Sin valor explícito asumimos el entorno más restrictivo que existe.
  return found ?? 'preview';
}

/**
 * Construye la configuración efectiva a partir del entorno.
 *
 * `SANDBOX_MODE` solo puede apagar el sandbox en producción. En cualquier otro
 * entorno la petición se registra y se ignora.
 */
export function resolveSandboxConfig(env: SandboxEnvSource): SandboxConfig {
  const salesOsEnv = parseEnv(env.SALES_OS_ENV);
  const requested = (env.SANDBOX_MODE ?? '').trim().toLowerCase();
  const wantsOff = requested === 'off' || requested === 'false' || requested === '0';
  const isProduction = salesOsEnv === 'production';

  return {
    env: salesOsEnv,
    enabled: !(wantsOff && isProduction),
    allowlist: splitAllowlistValue(env.SANDBOX_ALLOWLIST),
    ignoredDisableRequest: wantsOff && !isProduction,
  };
}

/** Interceptor listo para usar. Se construye una vez por proceso. */
export class SandboxInterceptor {
  readonly config: SandboxConfig;
  readonly rules: readonly AllowlistRule[];
  /** Entradas de la lista blanca que no se han podido interpretar. */
  readonly invalidEntries: readonly string[];

  constructor(config: SandboxConfig) {
    this.config = config;
    this.rules = parseAllowlist(config.allowlist);
    const recognised = new Set(this.rules.map((rule) => rule.raw));
    this.invalidEntries = config.allowlist.filter((entry) => !recognised.has(entry.trim()));
  }

  static fromEnv(env: SandboxEnvSource): SandboxInterceptor {
    return new SandboxInterceptor(resolveSandboxConfig(env));
  }

  /** Decide, sin lanzar, si un contacto saliente puede ejecutarse. */
  check(attempt: OutboundAttempt): SandboxDecision {
    const decidedAt = new Date();

    if (
      attempt.tenantId.trim() === '' ||
      attempt.recipient.trim() === '' ||
      attempt.agent.trim() === ''
    ) {
      return {
        allowed: false,
        attempt,
        decidedAt,
        reason: 'intento-incompleto',
        message:
          'Intento de contacto incompleto: hace falta tenant, agente y destinatario. Bloqueado por precaución.',
      };
    }

    if (!this.config.enabled) {
      return { allowed: true, attempt, decidedAt, via: 'produccion' };
    }

    if (this.rules.length === 0) {
      return {
        allowed: false,
        attempt,
        decidedAt,
        reason: 'lista-blanca-vacia',
        message:
          'Modo sandbox activo y lista blanca vacía: no se envía nada. Configura SANDBOX_ALLOWLIST con los destinatarios de prueba.',
      };
    }

    const match = matchesAllowlist(attempt.channel, attempt.recipient, this.rules);

    if (match.uninterpretable === true) {
      return {
        allowed: false,
        attempt,
        decidedAt,
        reason: 'destinatario-no-interpretable',
        message: `No se puede interpretar «${attempt.recipient}» como destinatario de ${attempt.channel}. Bloqueado por precaución.`,
      };
    }

    if (match.matched && match.rule) {
      return {
        allowed: true,
        attempt,
        decidedAt,
        via: 'lista-blanca',
        matchedRule: match.rule.raw,
      };
    }

    return {
      allowed: false,
      attempt,
      decidedAt,
      reason: 'no-en-lista-blanca',
      message: `Modo sandbox: «${attempt.recipient}» no está en la lista blanca de pruebas, así que no se envía nada por ${attempt.channel}. Añádelo a SANDBOX_ALLOWLIST si es un destinatario de prueba autorizado.`,
    };
  }

  /** Igual que `check`, pero lanza `SandboxBlockedError` si bloquea. */
  assert(attempt: OutboundAttempt): SandboxDecision & { allowed: true } {
    const decision = this.check(attempt);
    if (!decision.allowed) throw new SandboxBlockedError(decision);
    return decision;
  }

  /**
   * Envuelve la ejecución de un envío real. Ningún adaptador de
   * `packages/integrations` debe llamar a un proveedor sin pasar por aquí.
   */
  async guard<T>(attempt: OutboundAttempt, send: () => Promise<T>): Promise<T> {
    this.assert(attempt);
    return await send();
  }
}

let cached: SandboxInterceptor | null = null;

/**
 * Interceptor del proceso, construido desde `process.env`.
 *
 * Se memoriza porque la configuración de sandbox no cambia en caliente: si
 * cambia, el despliegue es nuevo.
 */
export function getSandboxInterceptor(): SandboxInterceptor {
  // Lectura explícita de cada variable: `process.env` solo tiene una firma de
  // índice y pasarlo entero no comprueba nada.
  cached ??= SandboxInterceptor.fromEnv({
    SALES_OS_ENV: process.env['SALES_OS_ENV'],
    SANDBOX_MODE: process.env['SANDBOX_MODE'],
    SANDBOX_ALLOWLIST: process.env['SANDBOX_ALLOWLIST'],
  });
  return cached;
}

/** Solo para tests: olvida el interceptor memorizado. */
export function resetSandboxInterceptor(): void {
  cached = null;
}
