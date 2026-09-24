/**
 * Los roles de un corporate, sin nada del servidor.
 *
 * Está separado de `sesion.ts` porque ese módulo importa `next/headers` y por
 * tanto solo existe en el servidor, mientras que los nombres de los roles y su
 * jerarquía los necesitan también los formularios del navegador. Mezclarlos
 * hacía que un componente de cliente arrastrara `next/headers` y el error
 * resultante —«You're importing a module that depends on next/headers»— señala
 * al fichero equivocado.
 *
 * Aquí no hay ninguna decisión de permisos: `puedeEditar` y `puedeAdministrar`
 * sirven para **decidir qué se enseña**. Lo que se puede hacer de verdad lo
 * decide RLS en la base.
 */

export type Rol = 'propietario' | 'administrador' | 'editor' | 'lector';

/** Un corporate al que pertenece quien está usando el panel. */
export interface TenantDelUsuario {
  readonly id: string;
  readonly nombre: string;
  readonly slug: string;
  readonly rol: Rol;
  readonly esDemo: boolean;
}

/** Los cuatro roles, de más a menos. El índice es el nivel. */
export const ROLES_DEL_PANEL: readonly Rol[] = ['propietario', 'administrador', 'editor', 'lector'];

/** Los que se pueden conceder en una invitación: el propietario no se invita. */
export const ROLES_INVITABLES: readonly Rol[] = ['administrador', 'editor', 'lector'];

export function alMenos(rol: Rol, minimo: Rol): boolean {
  return ROLES_DEL_PANEL.indexOf(rol) <= ROLES_DEL_PANEL.indexOf(minimo);
}

export function puedeEditar(rol: Rol): boolean {
  return alMenos(rol, 'editor');
}

export function puedeAdministrar(rol: Rol): boolean {
  return alMenos(rol, 'administrador');
}

export const ETIQUETA_DE_ROL: Readonly<Record<Rol, string>> = {
  propietario: 'Propietario',
  administrador: 'Administrador',
  editor: 'Editor',
  lector: 'Lector',
};

export const DESCRIPCION_DE_ROL: Readonly<Record<Rol, string>> = {
  propietario: 'Todo, incluido borrar el corporate y cambiar de propietario',
  administrador: 'Personas, credenciales, presupuesto y toda la configuración',
  editor: 'Configuración, archivos y aprobaciones. No toca personas ni credenciales',
  lector: 'Lo ve todo y no cambia nada. Puede proponer cambios',
};
