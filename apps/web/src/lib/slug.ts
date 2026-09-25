/**
 * La dirección corta de un corporate, a partir de su nombre.
 *
 * Vive fuera de las acciones de servidor porque es una función pura y merece
 * su test: es lo que acaba en URLs y en rutas de Storage, y un acento mal
 * quitado ahí se convierte en una carpeta que nadie encuentra.
 */
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Largo máximo de un slug: el `check` de `public.tenants` admite 49 caracteres. */
export const LARGO_MAXIMO_DE_SLUG = 49;

/**
 * Un slug con un sufijo que lo hace único (para los corporates que crea
 * `/lab`). Recorta la base **antes** de añadir el sufijo: si no, un nombre
 * largo produce un slug que la base rechaza.
 */
export function slugConSufijo(nombre: string, sufijo: string): string {
  const base = slugDesdeNombre(nombre)
    .slice(0, LARGO_MAXIMO_DE_SLUG - sufijo.length - 1)
    .replace(/-+$/, '');
  return base === '' ? sufijo : `${base}-${sufijo}`;
}
