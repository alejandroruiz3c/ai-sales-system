/**
 * @sales-os/integrations
 *
 * Adaptadores de servicios externos (CRM, correo, voz, pagos, firma, calendario,
 * WhatsApp, social, enriquecimiento) y el interceptor de modo sandbox, que es la
 * salvaguarda que hace imposible escribir a un prospecto real fuera de producción.
 */

export interface PackageManifest {
  readonly name: string;
  readonly description: string;
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/integrations',
  description: 'Adaptadores de servicios externos e interceptor de modo sandbox',
  phase: 'F0 (sandbox) · F4–F12 (adaptadores)',
};

export * from './sandbox/index.ts';
