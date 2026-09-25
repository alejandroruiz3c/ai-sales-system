/**
 * Cuánto ha costado una llamada, en euros (F2.5).
 *
 * El coste se calcula aquí a partir del uso que devuelve el proveedor, y no se
 * estima: lo que se apunta en `spend_ledger` es lo que se ha consumido.
 *
 * Dos cosas que cambian el precio y que el cálculo no puede olvidar:
 *
 *   · **la caché**: los tokens leídos de la caché cuestan una décima parte, y
 *     los escritos, un 25 % más. Una llamada con acierto de caché tiene que
 *     salir más barata en el libro, o el caso T2.3 no se puede comprobar;
 *   · **el modo lote**: la Batch API cobra la mitad de todo (T2.4).
 */

import type { Modelo } from './modelos.ts';

/** Tokens consumidos, separados como los factura el proveedor. */
export interface Uso {
  /** Entrada que no ha pasado por la caché. */
  readonly entrada: number;
  readonly salida: number;
  readonly cacheEscrita: number;
  readonly cacheLeida: number;
}

export const USO_VACIO: Uso = { entrada: 0, salida: 0, cacheEscrita: 0, cacheLeida: 0 };

export function sumarUso(a: Uso, b: Uso): Uso {
  return {
    entrada: a.entrada + b.entrada,
    salida: a.salida + b.salida,
    cacheEscrita: a.cacheEscrita + b.cacheEscrita,
    cacheLeida: a.cacheLeida + b.cacheLeida,
  };
}

/** Descuento de la Batch API sobre todo el uso. */
export const FACTOR_LOTE = 0.5;

/**
 * Tipo de cambio por defecto, en euros por dólar.
 *
 * El euro cotizó entre 1,02 y 1,18 dólares en 2025; 0,93 € por dólar equivale
 * a 1,075 $/€, del lado caro del rango: si se equivoca, apunta un poco **más**
 * gasto del real, y el presupuesto corta antes, no después. En el panel se
 * ajusta con `LLM_TIPO_CAMBIO_USD_EUR` sin tocar código.
 */
export const TIPO_CAMBIO_USD_EUR_POR_DEFECTO = 0.93;

export interface OpcionesDeCoste {
  /** Euros por dólar. */
  readonly tipoCambioUsdEur: number;
  readonly lote?: boolean;
}

const POR_MILLON = 1_000_000;

/** Coste en euros, con seis decimales como la columna del libro. */
export function costeEnEuros(modelo: Modelo, uso: Uso, opciones: OpcionesDeCoste): number {
  if (!(opciones.tipoCambioUsdEur > 0)) {
    throw new Error('El tipo de cambio dólar-euro tiene que ser un número positivo.');
  }
  const { precio } = modelo;
  const dolares =
    (uso.entrada * precio.entrada +
      uso.salida * precio.salida +
      uso.cacheEscrita * precio.escrituraCache +
      uso.cacheLeida * precio.lecturaCache) /
    POR_MILLON;
  const factor = opciones.lote === true ? FACTOR_LOTE : 1;
  return redondear(dolares * factor * opciones.tipoCambioUsdEur);
}

/**
 * El coste máximo que puede tener una llamada antes de hacerla.
 *
 * Es lo que se reserva en el presupuesto: toda la entrada al precio sin caché
 * (el peor caso, que es el de la primera llamada) y la salida entera hasta
 * `maxTokens`. Si la reserva no cabe en lo que le queda al tenant, la llamada
 * no se hace. Así el presupuesto corta **antes** de gastar y no después.
 */
export function costeMaximoEnEuros(
  modelo: Modelo,
  tokensDeEntrada: number,
  maxTokens: number,
  opciones: OpcionesDeCoste,
): number {
  return costeEnEuros(
    modelo,
    // La escritura de caché es más cara que la entrada normal: el peor caso
    // es que todo el prefijo se escriba.
    { entrada: 0, salida: maxTokens, cacheEscrita: tokensDeEntrada, cacheLeida: 0 },
    opciones,
  );
}

/**
 * Estimación de tokens de un texto, sin llamar al proveedor.
 *
 * Cuatro caracteres por token es la regla conocida para inglés; el castellano
 * sale algo peor, así que se usa 3,5 para no quedarse corto. Solo sirve para
 * reservar presupuesto y para avisar de que un prefijo no llega al mínimo de
 * caché; lo que se cobra sale siempre del uso real.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 3.5);
}

function redondear(euros: number): number {
  return Math.round(euros * 1_000_000) / 1_000_000;
}
