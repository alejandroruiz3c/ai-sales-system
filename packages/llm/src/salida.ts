/**
 * Validación de las salidas del modelo (F2.4).
 *
 * «El esquema es la frontera: lo que no valida, no entra» (CLAUDE.md §1). Una
 * salida de modelo es contenido externo como cualquier otro, y un agente que
 * se fía de que el JSON venga bien acaba metiendo en la base lo que el modelo
 * haya querido escribir.
 *
 * Aquí está solo la parte pura: sacar el JSON del texto y validarlo. El
 * reintento lo hace el router, porque es otra llamada y se cobra.
 */

import type { z } from 'zod';

export type ResultadoDeValidacion<T> =
  | { readonly valida: true; readonly datos: T }
  | { readonly valida: false; readonly errores: readonly string[] };

/**
 * Saca el JSON de la respuesta.
 *
 * Con salidas estructuradas el texto ya es JSON puro. Sin ellas, los modelos
 * a veces lo envuelven en un bloque de código o le ponen una frase delante; se
 * acepta eso y nada más. No se «repara» un JSON roto: si no se puede leer, es
 * un fallo y se reintenta.
 */
export function extraerJson(texto: string): unknown {
  const limpio = texto.trim();
  const bloque = /^```(?:json)?\s*\n([\s\S]*?)\n```$/u.exec(limpio);
  const candidato = bloque?.[1] ?? limpio;
  try {
    return JSON.parse(candidato);
  } catch {
    const inicio = candidato.indexOf('{');
    const fin = candidato.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio)
      throw new SyntaxError('La respuesta no contiene un objeto JSON.');
    return JSON.parse(candidato.slice(inicio, fin + 1));
  }
}

/** Valida el texto de una respuesta contra el esquema, sin lanzar. */
export function validarSalida<T>(texto: string, esquema: z.ZodType<T>): ResultadoDeValidacion<T> {
  let json: unknown;
  try {
    json = extraerJson(texto);
  } catch (error) {
    return {
      valida: false,
      errores: [
        `No es JSON válido: ${error instanceof Error ? error.message : 'error de lectura'}`,
      ],
    };
  }
  const resultado = esquema.safeParse(json);
  if (resultado.success) return { valida: true, datos: resultado.data };
  return {
    valida: false,
    errores: resultado.error.issues.map((i) => {
      const ruta = i.path.length === 0 ? '(raíz)' : i.path.map(String).join('.');
      return `${ruta}: ${i.message}`;
    }),
  };
}

/**
 * El mensaje con el que se pide la corrección en el reintento.
 *
 * Lleva los errores concretos, porque «vuelve a intentarlo» sin decir qué
 * falló produce la misma respuesta. El bloque fijo del prompt no cambia, así
 * que el reintento aprovecha la caché de la primera llamada.
 */
export function mensajeDeCorreccion(errores: readonly string[]): string {
  return [
    'Tu respuesta anterior no cumple el formato de salida pedido. Errores:',
    ...errores.slice(0, 10).map((e) => `- ${e}`),
    'Responde otra vez a la misma petición, solo con el objeto JSON válido y sin texto alrededor.',
  ].join('\n');
}
