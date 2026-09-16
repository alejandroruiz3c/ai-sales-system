/**
 * @sales-os/core
 *
 * Tipos, contratos de eventos Zod, máquina de estados, errores y reglas transversales
 *
 * Paquete reservado en F0. Se implementa en F1–F6.
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
  name: '@sales-os/core',
  description:
    'Tipos, contratos de eventos Zod, máquina de estados, errores y reglas transversales',
  phase: 'F1–F6',
};
