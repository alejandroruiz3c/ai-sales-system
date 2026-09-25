import { describe, expect, it } from 'vitest';

import { costeEnEuros, costeMaximoEnEuros, estimarTokens } from './coste.ts';
import { elegirModelo } from './modelos.ts';

const haiku = elegirModelo('ligero');
const sonnet = elegirModelo('medio');
const conCambio = { tipoCambioUsdEur: 0.93 };

describe('costeEnEuros (F2.5)', () => {
  it('una clasificación típica con el modelo ligero cuesta menos de una milésima de euro (T2.1)', () => {
    const coste = costeEnEuros(
      haiku,
      { entrada: 450, salida: 90, cacheEscrita: 0, cacheLeida: 0 },
      conCambio,
    );
    expect(coste).toBeGreaterThan(0);
    expect(coste).toBeLessThan(0.001);
  });

  it('leer de la caché sale más barato que leer sin caché (T2.3)', () => {
    const sin = costeEnEuros(
      sonnet,
      { entrada: 1800, salida: 300, cacheEscrita: 0, cacheLeida: 0 },
      conCambio,
    );
    const con = costeEnEuros(
      sonnet,
      { entrada: 300, salida: 300, cacheEscrita: 0, cacheLeida: 1500 },
      conCambio,
    );
    expect(con).toBeLessThan(sin);
  });

  it('escribir en la caché cuesta un 25 % más que la entrada normal', () => {
    const normal = costeEnEuros(
      sonnet,
      { entrada: 1_000_000, salida: 0, cacheEscrita: 0, cacheLeida: 0 },
      { tipoCambioUsdEur: 1 },
    );
    const escrita = costeEnEuros(
      sonnet,
      { entrada: 0, salida: 0, cacheEscrita: 1_000_000, cacheLeida: 0 },
      { tipoCambioUsdEur: 1 },
    );
    expect(escrita / normal).toBeCloseTo(1.25, 5);
  });

  it('el modo lote cobra la mitad del mismo uso (T2.4)', () => {
    const uso = { entrada: 400, salida: 80, cacheEscrita: 0, cacheLeida: 0 };
    expect(costeEnEuros(haiku, uso, { ...conCambio, lote: true })).toBeCloseTo(
      costeEnEuros(haiku, uso, conCambio) / 2,
      6,
    );
  });

  it('convierte con el tipo de cambio que recibe', () => {
    const uso = { entrada: 1_000_000, salida: 0, cacheEscrita: 0, cacheLeida: 0 };
    expect(costeEnEuros(haiku, uso, { tipoCambioUsdEur: 1 })).toBe(1);
    expect(costeEnEuros(haiku, uso, { tipoCambioUsdEur: 0.5 })).toBe(0.5);
  });

  it('rechaza un tipo de cambio que no es positivo en vez de apuntar coste cero', () => {
    const uso = { entrada: 10, salida: 10, cacheEscrita: 0, cacheLeida: 0 };
    expect(() => costeEnEuros(haiku, uso, { tipoCambioUsdEur: 0 })).toThrow(/tipo de cambio/);
    expect(() => costeEnEuros(haiku, uso, { tipoCambioUsdEur: Number.NaN })).toThrow(
      /tipo de cambio/,
    );
  });

  it('el coste máximo cubre el peor caso: nunca es menor que el real de la misma llamada', () => {
    const real = costeEnEuros(
      sonnet,
      { entrada: 200, salida: 500, cacheEscrita: 1000, cacheLeida: 0 },
      conCambio,
    );
    expect(costeMaximoEnEuros(sonnet, 1200, 500, conCambio)).toBeGreaterThanOrEqual(real);
  });
});

describe('estimarTokens', () => {
  it('no se queda corto con el castellano (3,5 caracteres por token)', () => {
    expect(estimarTokens('a'.repeat(350))).toBe(100);
    expect(estimarTokens('')).toBe(0);
  });
});
