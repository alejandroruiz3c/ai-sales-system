/**
 * @sales-os/agent-coordinator
 *
 * Coordinador de outreach: máquina de estados, cadencias y parada cruzada entre canales
 *
 * Paquete reservado en F0. Se implementa en F6.
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
  name: '@sales-os/agent-coordinator',
  description:
    'Coordinador de outreach: máquina de estados, cadencias y parada cruzada entre canales',
  phase: 'F6',
};
