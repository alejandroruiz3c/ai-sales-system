/**
 * @sales-os/agent-opinion
 *
 * Agente Generador de Opinión: detecta conversaciones de valor y propone respuestas
 *
 * Paquete reservado en F0. Se implementa en F12.
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
  name: '@sales-os/agent-opinion',
  description: 'Agente Generador de Opinión: detecta conversaciones de valor y propone respuestas',
  phase: 'F12',
};
