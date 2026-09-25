/**
 * Registro de plantillas base.
 *
 * Una plantilla que no está aquí no existe para el sistema: ni se evalúa, ni la
 * enseña el probador de `/lab`, ni la podrá editar el Estudio (F2B). Añadir
 * una plantilla es añadirla a esta lista, con sus casos de eval y su umbral
 * (`evals/`), y el test del sello lo exige.
 */

import type { Plantilla } from './plantilla.ts';
import { clasificarRespuesta } from './plantillas/clasificar-respuesta.ts';
import { redactarEmail } from './plantillas/redactar-email.ts';

export const PLANTILLAS = {
  'clasificar-respuesta': clasificarRespuesta,
  'redactar-email': redactarEmail,
} as const satisfies Record<string, Plantilla>;

export type IdDePlantilla = keyof typeof PLANTILLAS;

/** Las claves del registro, como tupla: para `z.enum` y para los selectores. Un test comprueba que coinciden. */
export const IDS_DE_PLANTILLA = [
  'clasificar-respuesta',
  'redactar-email',
] as const satisfies readonly IdDePlantilla[];

export function esIdDePlantilla(id: string): id is IdDePlantilla {
  return Object.hasOwn(PLANTILLAS, id);
}
