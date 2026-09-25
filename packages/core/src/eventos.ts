/**
 * Contratos de eventos del bus (plan §2.5).
 *
 * Todos los agentes se comunican por eventos tipados con nombre versionado, y
 * **el esquema es la frontera: lo que no valida, no entra** (CLAUDE.md §1).
 * Este fichero es la lista completa de nombres que el sistema reconoce y la
 * forma mínima de cualquier evento.
 *
 * Tres decisiones que conviene entender antes de añadir uno:
 *
 * 1. **El nombre lleva versión aparte del nombre**, no dentro. En la base son
 *    dos columnas (`nombre`, `version`) y en Inngest se juntan
 *    (`sales-os/prospect.qualified.v1`). Así se puede consultar «todos los
 *    `prospect.qualified`, de cualquier versión» sin comodines.
 * 2. **Todo evento lleva `tenantId`.** No hay evento de plataforma en este bus:
 *    si algo no pertenece a un corporate, no es un evento del bus.
 * 3. **La carga (`datos`) se valida por evento, no aquí.** Este módulo valida
 *    el sobre; cada agente valida su contenido. Un sobre común es lo que
 *    permite que el visor, la auditoría y el reproceso funcionen con eventos
 *    que no conocen.
 */

import { z } from 'zod';

/**
 * Los nombres que el bus reconoce, tal cual aparecen en el plan §2.5.
 *
 * Añadir uno es editar esta lista en un PR. Es a propósito: un evento que
 * nadie ha declarado es un evento que el visor no sabe pintar, el Copiloto no
 * sabe explicar y el reproceso no sabe reinyectar.
 */
export const NOMBRES_DE_EVENTO = [
  // Ciclo de vida del tenant y del panel (F1)
  'tenant.created',
  'tenant.updated',
  'tenant.secret.saved',
  'tenant.secret.deleted',
  'membership.invited',
  'membership.accepted',
  'membership.revoked',
  'file.uploaded',
  'file.replaced',
  'file.deleted',
  'config.published',
  'config.reverted',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'budget.threshold.reached',

  // Prospección y flujo (F5–F12)
  'prospect.ingested',
  'prospect.qualified',
  'prospect.disqualified',
  'crm.lead.created',
  'outreach.step.scheduled',
  'outreach.step.sent',
  'outreach.step.suppressed',
  'outreach.reply.received',
  'outreach.channel.succeeded',
  'meeting.booked',
  'call.completed',
  'deal.close_intent',
  'deal.won',
  'payment.succeeded',
  'customer.created',
  'cs.feedback.product',
  'opinion.opportunity.detected',

  // Modelos (F2): un lote de la Batch API, al enviarse y al recogerse. El
  // lote tarda de minutos a horas, y la tabla `events` es la que guarda qué
  // se envió y qué volvió (ADR 0002), no la cola.
  'llm.batch.submitted',
  'llm.batch.completed',

  // Capacidad y salud (F13)
  'machine.limit.reached',
  'machine.health.degraded',

  // Solo para el kit de prueba. Existe porque los casos T1.7, T1.8 y T1.9
  // necesitan un agente que no sea ninguno de los reales.
  'prueba.accion.generada',
  'prueba.accion.enviada',
] as const;

export type NombreDeEvento = (typeof NOMBRES_DE_EVENTO)[number];

export const ORIGENES_DE_EVENTO = [
  'panel',
  'api',
  'webhook',
  'inngest',
  'sistema',
  'worker',
  'lab',
] as const;

export type OrigenDeEvento = (typeof ORIGENES_DE_EVENTO)[number];

const UUID = z.uuid({ error: 'El identificador tiene que ser un uuid.' });

/** El sobre de cualquier evento del bus. */
export const esquemaEvento = z.object({
  id: UUID.optional(),
  tenantId: UUID,
  nombre: z.enum(NOMBRES_DE_EVENTO, {
    error: 'Ese nombre de evento no está declarado en packages/core/src/eventos.ts.',
  }),
  version: z.number().int().min(1).default(1),
  agente: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,40}$/, { error: 'La clave del agente va en minúsculas y guiones.' })
    .default('sistema'),
  origen: z.enum(ORIGENES_DE_EVENTO).default('panel'),
  datos: z.record(z.string(), z.unknown()).default({}),
  correlacionId: UUID.optional(),
  claveIdempotencia: z.string().min(1).max(200).optional(),
});

export type Evento = z.infer<typeof esquemaEvento>;

/** Prefijo de los eventos de este sistema en Inngest. */
export const PREFIJO_INNGEST = 'sales-os/';

/**
 * Nombre del evento en Inngest: `sales-os/prospect.qualified.v1`.
 *
 * La versión va al final y no al principio para que los nombres de un mismo
 * evento queden juntos al ordenarlos, que es como se leen en su panel.
 */
export function nombreInngest(nombre: string, version = 1): string {
  return `${PREFIJO_INNGEST}${nombre}.v${String(version)}`;
}

/** La operación inversa, para leer lo que llega de Inngest. */
export function desdeNombreInngest(
  nombreCompleto: string,
): { nombre: string; version: number } | undefined {
  if (!nombreCompleto.startsWith(PREFIJO_INNGEST)) return undefined;
  const resto = nombreCompleto.slice(PREFIJO_INNGEST.length);
  const corte = resto.lastIndexOf('.v');
  if (corte <= 0) return undefined;
  const version = Number(resto.slice(corte + 2));
  if (!Number.isInteger(version) || version < 1) return undefined;
  return { nombre: resto.slice(0, corte), version };
}

/**
 * Clave de concurrencia de Inngest. **Siempre incluye el tenant**
 * (CLAUDE.md §1): sin él, un corporate puede consumir la capacidad de otro o
 * hacer que se supere el límite de una máquina ajena.
 */
export function claveDeConcurrencia(tenantId: string, ...partes: string[]): string {
  return [tenantId, ...partes.filter((p) => p !== '')].join(':');
}

export interface ResultadoDeValidacionDeEvento {
  readonly valido: boolean;
  readonly evento?: Evento;
  readonly errores: readonly string[];
}

/**
 * Valida el sobre de un evento antes de publicarlo.
 *
 * Lo que no valida, no entra: ni en la tabla `events` ni en la cola. Publicar
 * un evento con un nombre que nadie ha declarado es sembrar un hueco que
 * aparecerá semanas después como «una secuencia se detuvo sin motivo».
 */
export function validarEvento(valor: unknown): ResultadoDeValidacionDeEvento {
  const resultado = esquemaEvento.safeParse(valor);
  if (resultado.success) return { valido: true, evento: resultado.data, errores: [] };
  return {
    valido: false,
    errores: resultado.error.issues.map((i) =>
      i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message,
    ),
  };
}
