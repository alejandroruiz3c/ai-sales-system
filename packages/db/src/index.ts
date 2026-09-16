/**
 * @sales-os/db
 *
 * Esquema Drizzle, migraciones versionadas, políticas RLS y seeds
 *
 * Paquete reservado en F0. Se implementa en F1.
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
  name: '@sales-os/db',
  description: 'Esquema Drizzle, migraciones versionadas, políticas RLS y seeds',
  phase: 'F1',
};
