/**
 * Contratos del interceptor de modo sandbox (F0.15).
 *
 * El interceptor es una **salvaguarda bloqueada**: no se edita desde el Estudio
 * y no se desactiva fuera de producción (plan §5B.2 y §F2B, "salvaguardas
 * bloqueadas"). Su trabajo es que en staging y en las previews sea
 * técnicamente imposible escribir a un prospecto real.
 */

/** Canales por los que el sistema puede contactar con una persona. */
export const OUTBOUND_CHANNELS = [
  'email',
  'linkedin',
  'voice',
  'whatsapp',
  'sms',
  'social',
] as const;

export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

/** Entorno en el que corre esta instalación. */
export const SALES_OS_ENVS = ['dev', 'preview', 'staging', 'production'] as const;

export type SalesOsEnv = (typeof SALES_OS_ENVS)[number];

/** Un intento de contacto saliente, antes de ejecutarse. */
export interface OutboundAttempt {
  /** Tenant que intenta el contacto. Nunca opcional: todo lleva tenant. */
  readonly tenantId: string;
  readonly channel: OutboundChannel;
  /**
   * Destinatario tal como lo tiene el sistema: dirección de email, teléfono en
   * E.164, URL o handle de LinkedIn, o `plataforma:handle` en redes sociales.
   */
  readonly recipient: string;
  /** Agente que origina el contacto, para poder auditarlo. */
  readonly agent: string;
}

export type SandboxBlockReason =
  /** El destinatario no está en la lista blanca de pruebas. */
  | 'no-en-lista-blanca'
  /** El modo sandbox está activo y la lista blanca está vacía. */
  | 'lista-blanca-vacia'
  /** El destinatario no se puede interpretar para ese canal: se bloquea por precaución. */
  | 'destinatario-no-interpretable'
  /** Faltan datos del intento (tenant, canal o destinatario). */
  | 'intento-incompleto';

interface SandboxDecisionBase {
  readonly attempt: OutboundAttempt;
  /** Momento de la decisión, para el registro de auditoría. */
  readonly decidedAt: Date;
}

export interface SandboxAllowed extends SandboxDecisionBase {
  readonly allowed: true;
  /**
   * `produccion`  el sandbox está desactivado porque este es el entorno real.
   * `lista-blanca` el destinatario está en la lista blanca.
   */
  readonly via: 'produccion' | 'lista-blanca';
  /** Regla de la lista blanca que ha permitido el envío, si aplica. */
  readonly matchedRule?: string;
}

export interface SandboxBlocked extends SandboxDecisionBase {
  readonly allowed: false;
  readonly reason: SandboxBlockReason;
  /** Explicación en castellano, pensada para mostrarse en el panel y en /lab. */
  readonly message: string;
}

export type SandboxDecision = SandboxAllowed | SandboxBlocked;

/** Configuración efectiva del interceptor. */
export interface SandboxConfig {
  readonly env: SalesOsEnv;
  /** `true` = todo contacto saliente pasa por la lista blanca. */
  readonly enabled: boolean;
  readonly allowlist: readonly string[];
  /**
   * Se rellena cuando alguien ha pedido desactivar el sandbox en un entorno que
   * no es producción. La peticion se ignora y queda constancia.
   */
  readonly ignoredDisableRequest: boolean;
}
