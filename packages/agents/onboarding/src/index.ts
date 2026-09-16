/**
 * @sales-os/agent-onboarding
 *
 * Agente de Onboarding: interpreta deck, web y argumentario y genera el perfil comercial
 *
 * Paquete reservado en F0. Se implementa en F3.
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
  name: '@sales-os/agent-onboarding',
  description:
    'Agente de Onboarding: interpreta deck, web y argumentario y genera el perfil comercial',
  phase: 'F3',
};
