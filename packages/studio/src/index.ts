/**
 * @sales-os/studio
 *
 * Registro de agentes, capas de configuración base+tenant y versionado
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
  name: '@sales-os/studio',
  description: 'Registro de agentes, capas de configuración base+tenant y versionado',
  phase: 'F2B',
};
