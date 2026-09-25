/**
 * El sello de las evals: la puerta que corre en cada PR (F2.7, ADR 0011).
 *
 * Ejecutar las evals cuesta dinero y necesita la clave del proveedor, así que
 * no se ejecutan en cada build. Lo que sí se comprueba en cada build, dentro de
 * `pnpm verify` y por tanto del check de Vercel, es que **el último resultado
 * guardado corresponde a lo que hay en el PR**:
 *
 *   1. existe un resultado para cada plantilla del registro;
 *   2. su **huella** es la de la plantilla y los casos actuales. Si alguien
 *      cambia una coma del prompt y no vuelve a ejecutar las evals, la huella
 *      no coincide y el PR se pone rojo;
 *   3. su puntuación llega al **umbral** de la plantilla;
 *   4. no ha **bajado** respecto a la anterior, salvo aceptación expresa con
 *      su motivo («un PR que baja la puntuación de evals de un agente no se
 *      fusiona», CLAUDE.md §1).
 *
 * El resultado es un JSON versionado, así que falsificarlo es posible y se ve
 * en el diff del PR. Es el mismo nivel de garantía que el resto de la revisión.
 */

import { createHash } from 'node:crypto';

import { elegirModelo } from '@sales-os/llm';

import { huellaDePlantilla, type Plantilla } from '../src/plantilla.ts';
import type { CasoDeEval } from './casos.ts';

export interface DetalleDeCaso {
  readonly caso: string;
  readonly aprobado: boolean;
  readonly motivo: string;
}

export interface ResultadoSellado {
  readonly plantilla: string;
  readonly version: string;
  readonly huella: string;
  readonly modelo: string;
  readonly fecha: string;
  readonly casos: number;
  readonly aprobados: number;
  readonly puntuacion: number;
  readonly umbral: number;
  readonly costeEur: number;
  readonly anterior: { readonly puntuacion: number; readonly huella: string } | null;
  readonly aceptacionDeBajada: { readonly motivo: string; readonly aceptadoPor: string } | null;
  readonly detalle: readonly DetalleDeCaso[];
}

/**
 * El código del evaluador sin lo que no cambia su lógica: comentarios,
 * espacios, saltos de línea y comas finales. Prettier corre en cada commit, y
 * ni un cambio de formato ni un comentario pueden invalidar el sello; un
 * cambio de lógica, sí.
 *
 * Quitar comentarios con una expresión regular es aproximado (una cadena con
 * `//` dentro perdería su final), y es suficiente para un evaluador sin URLs.
 * Si alguna vez las tuviera, el efecto sería una huella más sensible, nunca
 * menos: el sello pediría volver a evaluar de más, no de menos.
 */
export function normalizarCodigo(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
    .replace(/\s+/gu, '')
    .replace(/,([)\]}])/gu, '$1');
}

/**
 * Huella de lo evaluado: plantilla, casos, evaluador y modelo.
 *
 * El modelo entra porque cambiar el modelo ligero del catálogo cambia las
 * salidas de todas las plantillas ligeras, y eso también hay que evaluarlo.
 * El evaluador entra porque relajar una comprobación es como bajar el umbral.
 */
export function huellaDeEvals(
  plantilla: Plantilla,
  casos: readonly CasoDeEval[],
  codigoDelEvaluador: string,
): string {
  const modelo = elegirModelo(plantilla.nivel).id;
  return createHash('sha256')
    .update(huellaDePlantilla(plantilla))
    .update(JSON.stringify(casos))
    .update(normalizarCodigo(codigoDelEvaluador))
    .update(modelo)
    .digest('hex');
}

/** Errores del sello de una plantilla. Vacío si la puerta está abierta. */
export function comprobarSello(
  plantilla: Plantilla,
  sello: ResultadoSellado | undefined,
  umbral: number | undefined,
  huellaActual: string,
): string[] {
  const id = plantilla.id;
  const ejecuta = `Ejecuta \`pnpm evals ${id}\` y sube el resultado.`;
  if (umbral === undefined) return [`${id} no tiene umbral en evals/umbrales.json.`];
  if (sello === undefined) return [`${id} no tiene resultado de evals. ${ejecuta}`];

  const errores: string[] = [];
  if (sello.plantilla !== id) errores.push(`El resultado de ${id} dice ser de ${sello.plantilla}.`);
  if (sello.huella !== huellaActual) {
    errores.push(
      `La plantilla ${id}, sus casos, su evaluador o su modelo han cambiado desde la última eval. ${ejecuta}`,
    );
  }
  if (sello.puntuacion < umbral) {
    errores.push(
      `${id} puntúa ${String(sello.puntuacion)} y su umbral es ${String(umbral)}: no se fusiona.`,
    );
  }
  if (
    sello.anterior !== null &&
    sello.puntuacion < sello.anterior.puntuacion &&
    sello.aceptacionDeBajada === null
  ) {
    errores.push(
      `${id} baja de ${String(sello.anterior.puntuacion)} a ${String(sello.puntuacion)}. Una bajada necesita aceptación expresa: \`pnpm evals ${id} --acepto-bajada "motivo"\`.`,
    );
  }
  if (
    sello.aprobados > sello.casos ||
    Math.abs(sello.aprobados / Math.max(1, sello.casos) - sello.puntuacion) > 1e-9
  ) {
    errores.push(
      `El resultado de ${id} no cuadra: ${String(sello.aprobados)} de ${String(sello.casos)} no es ${String(sello.puntuacion)}.`,
    );
  }
  return errores;
}
