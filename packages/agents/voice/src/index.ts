/**
 * @sales-os/agent-voice
 *
 * Agente de llamadas: guion adaptado, agenda en directo y detección de cierre
 *
 * Paquete reservado en F0. Se implementa en F9.
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
  name: '@sales-os/agent-voice',
  description: 'Agente de llamadas: guion adaptado, agenda en directo y detección de cierre',
  phase: 'F9',
};
