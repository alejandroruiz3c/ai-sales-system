/**
 * @sales-os/agent-email
 *
 * Agente de emailing: redacción, límites por buzón y gestión de respuestas
 *
 * Paquete reservado en F0. Se implementa en F7.
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
  name: '@sales-os/agent-email',
  description: 'Agente de emailing: redacción, límites por buzón y gestión de respuestas',
  phase: 'F7',
};
