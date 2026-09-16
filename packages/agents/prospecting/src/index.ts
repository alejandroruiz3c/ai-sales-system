/**
 * @sales-os/agent-prospecting
 *
 * Agente de Prospección BRAIN: busca, enriquece, cualifica y maximiza decisores
 *
 * Paquete reservado en F0. Se implementa en F5.
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
  name: '@sales-os/agent-prospecting',
  description: 'Agente de Prospección BRAIN: busca, enriquece, cualifica y maximiza decisores',
  phase: 'F5',
};
