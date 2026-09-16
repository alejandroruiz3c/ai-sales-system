/**
 * @sales-os/llm
 *
 * Router de modelos, caché de prompts, modo lote y contabilidad de coste
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
  name: '@sales-os/llm',
  description: 'Router de modelos, caché de prompts, modo lote y contabilidad de coste',
  phase: 'F2',
};
