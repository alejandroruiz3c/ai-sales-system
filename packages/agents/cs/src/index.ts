/**
 * @sales-os/agent-cs
 *
 * Agente Upsales + Customer Success: limpieza de CRM, campañas, feedback y ampliación
 *
 * Paquete reservado en F0. Se implementa en F11.
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
  name: '@sales-os/agent-cs',
  description: 'Agente Upsales + Customer Success: limpieza de CRM, campañas, feedback y ampliación',
  phase: 'F11',
};
