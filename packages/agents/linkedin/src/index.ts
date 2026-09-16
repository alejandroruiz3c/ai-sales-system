/**
 * @sales-os/agent-linkedin
 *
 * Agente de pantalla LinkedIn: invitaciones, mensajes y lectura de bandeja
 *
 * Paquete reservado en F0. Se implementa en F8.
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
  name: '@sales-os/agent-linkedin',
  description: 'Agente de pantalla LinkedIn: invitaciones, mensajes y lectura de bandeja',
  phase: 'F8',
};
