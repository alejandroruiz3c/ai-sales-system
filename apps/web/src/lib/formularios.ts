/**
 * Leer un `FormData` sin mentirle al compilador.
 *
 * `FormData.get()` devuelve `string | File | null`, y envolverlo en `String()`
 * convierte un fichero en `[object Object]` sin que nada avise. Estas dos
 * funciones son la única forma de leer un campo en el panel, y devuelven lo
 * que dicen devolver.
 */

export function texto(datos: FormData, campo: string, porDefecto = ''): string {
  const valor = datos.get(campo);
  return typeof valor === 'string' ? valor : porDefecto;
}

export function numero(datos: FormData, campo: string): number | undefined {
  const valor = texto(datos, campo).replace(',', '.').trim();
  if (valor === '') return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

export function activado(datos: FormData, campo: string): boolean {
  const valor = datos.get(campo);
  return valor === 'on' || valor === 'true';
}

export function fichero(datos: FormData, campo: string): File | undefined {
  const valor = datos.get(campo);
  return valor instanceof File && valor.size > 0 ? valor : undefined;
}
