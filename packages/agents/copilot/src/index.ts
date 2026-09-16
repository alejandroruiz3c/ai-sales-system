/**
 * @sales-os/agent-copilot
 *
 * Copiloto SALES OS: ayuda, diagnóstico, métricas y cambios guiados
 *
 * Paquete reservado en F0. Se implementa en F2B.
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
  name: '@sales-os/agent-copilot',
  description: 'Copiloto SALES OS: ayuda, diagnóstico, métricas y cambios guiados',
  phase: 'F2B',
};
