/**
 * Cliente de Inngest (F0.10).
 *
 * Inngest es el orquestador de workflows durables del sistema: reintentos,
 * `step.sleep` de días, cancelación para la parada cruzada entre canales y
 * claves de concurrencia por tenant y por máquina (plan §2.2).
 *
 * En F0 solo hay una función "hello" para comprobar de punta a punta que el
 * evento sale, se ejecuta y vuelve.
 */

import { nombreInngest } from '@sales-os/core';
import { eventType, Inngest } from 'inngest';
import { z } from 'zod';

/**
 * Los eventos se validan con Zod desde el primer día y su nombre lleva versión,
 * como fija el plan (§2.5): cambiar la forma de un evento no rompe a quien
 * todavía escucha el anterior.
 *
 * Todo evento lleva `tenantId`. No es un campo opcional en ningún evento del
 * sistema.
 */
export const helloRequested = eventType('sales-os/hello.requested.v1', {
  schema: z.object({
    tenantId: z.string().min(1),
    /** Quién lo lanzó, para poder auditarlo. */
    requestedBy: z.string().min(1),
  }),
});

/**
 * Un lote de la Batch API enviado desde `/lab` (F2.3, caso T2.4). La función
 * `recoger-lote-llm` lo consulta hasta que termina y anota el resultado. El
 * nombre sale de `nombreInngest`, igual que el del evento de la tabla.
 */
const esquemaLoteLlmEnviado = z.object({
  tenantId: z.uuid(),
  loteId: z.string().min(1),
  reservaId: z.uuid(),
  hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LoteLlmEnviado = z.infer<typeof esquemaLoteLlmEnviado>;

export const NOMBRE_LOTE_LLM_ENVIADO = nombreInngest('llm.batch.submitted');

export const loteLlmEnviado = eventType(NOMBRE_LOTE_LLM_ENVIADO, { schema: esquemaLoteLlmEnviado });

const inngestEnv = process.env['INNGEST_ENV'];

export const inngest = new Inngest({
  id: 'sales-os',
  // `exactOptionalPropertyTypes` no admite pasar `undefined` explícitamente:
  // o la propiedad está con valor, o no está.
  ...(inngestEnv ? { env: inngestEnv } : {}),
});
