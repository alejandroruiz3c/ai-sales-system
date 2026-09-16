/**
 * @sales-os/prompts
 *
 * Plantillas de prompt versionadas por agente y sus evals de promptfoo
 *
 * Paquete reservado en F0. Se implementa en F2.
 */

export interface PackageManifest {
  /** Nombre del paquete en el workspace. */
  readonly name: string;
  /** Qué resuelve este paquete. */
  readonly description: string;
  /** Fase del plan en la que se implementa. */
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/prompts',
  description: 'Plantillas de prompt versionadas por agente y sus evals de promptfoo',
  phase: 'F2',
};
