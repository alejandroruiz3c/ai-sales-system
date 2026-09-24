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
