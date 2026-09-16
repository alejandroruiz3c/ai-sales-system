/**
 * @sales-os/agent-closing
 *
 * Agente de cierre y facturación: pago, NDA, Excel de onboarding y paso en CRM
 *
 * Paquete reservado en F0. Se implementa en F10.
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
  name: '@sales-os/agent-closing',
  description: 'Agente de cierre y facturación: pago, NDA, Excel de onboarding y paso en CRM',
  phase: 'F10',
};
