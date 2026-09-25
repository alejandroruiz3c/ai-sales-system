import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PLANTILLAS } from '../src/registro.ts';
import { CASOS } from './casos.ts';
import { comprobarSello, huellaDeEvals, type ResultadoSellado } from './sello.ts';

const CODIGO_DEL_EVALUADOR = readFileSync(new URL('./evaluar.ts', import.meta.url), 'utf8');
const umbrales = (
  JSON.parse(readFileSync(new URL('./umbrales.json', import.meta.url), 'utf8')) as {
    umbrales: Record<string, number>;
  }
).umbrales;

function leerSello(id: string): ResultadoSellado | undefined {
  try {
    return JSON.parse(
      readFileSync(new URL(`./resultados/${id}.json`, import.meta.url), 'utf8'),
    ) as ResultadoSellado;
  } catch {
    return undefined;
  }
}

/**
 * La puerta de verdad: corre en `pnpm verify`, y por tanto en el check de
 * Vercel de cada PR. Si falla, el mensaje dice qué comando ejecutar.
 */
describe('sello de evals de cada plantilla del registro (F2.7)', () => {
  for (const [id, plantilla] of Object.entries(PLANTILLAS)) {
    it(`${id}: resultado al día, sobre el umbral y sin bajadas sin aceptar`, () => {
      const huella = huellaDeEvals(
        plantilla,
        CASOS[id as keyof typeof CASOS],
        CODIGO_DEL_EVALUADOR,
      );
      expect(comprobarSello(plantilla, leerSello(id), umbrales[id], huella)).toEqual([]);
    });
  }
});

describe('comprobarSello', () => {
  const plantilla = PLANTILLAS['clasificar-respuesta'];
  const base: ResultadoSellado = {
    plantilla: 'clasificar-respuesta',
    version: '1.x',
    huella: 'h',
    modelo: 'm',
    fecha: '2026-09-25',
    casos: 20,
    aprobados: 19,
    puntuacion: 0.95,
    umbral: 0.9,
    costeEur: 0.01,
    anterior: null,
    aceptacionDeBajada: null,
    detalle: [],
  };

  it('abre la puerta con huella al día y puntuación sobre el umbral', () => {
    expect(comprobarSello(plantilla, base, 0.9, 'h')).toEqual([]);
  });
  it('la cierra si la plantilla cambió y no se volvió a evaluar', () => {
    expect(comprobarSello(plantilla, base, 0.9, 'otra').join()).toMatch(/han cambiado/);
  });
  it('la cierra por debajo del umbral', () => {
    expect(
      comprobarSello(plantilla, { ...base, aprobados: 17, puntuacion: 0.85 }, 0.9, 'h').join(),
    ).toMatch(/umbral/);
  });
  it('una bajada sin aceptación expresa cierra la puerta; con aceptación, no', () => {
    const bajada = {
      ...base,
      aprobados: 18,
      puntuacion: 0.9,
      anterior: { puntuacion: 0.95, huella: 'vieja' },
    };
    expect(comprobarSello(plantilla, bajada, 0.9, 'h').join()).toMatch(/aceptación expresa/);
    expect(
      comprobarSello(
        plantilla,
        { ...bajada, aceptacionDeBajada: { motivo: 'prompt más corto', aceptadoPor: 'Alex' } },
        0.9,
        'h',
      ),
    ).toEqual([]);
  });
  it('sin resultado o sin umbral, lo dice con el comando que hay que ejecutar', () => {
    expect(comprobarSello(plantilla, undefined, 0.9, 'h').join()).toMatch(
      /pnpm evals clasificar-respuesta/,
    );
    expect(comprobarSello(plantilla, base, undefined, 'h').join()).toMatch(/umbral/);
  });
  it('detecta un resultado que no cuadra (aprobados y puntuación inventados)', () => {
    expect(comprobarSello(plantilla, { ...base, aprobados: 10 }, 0.9, 'h').join()).toMatch(
      /no cuadra/,
    );
  });
  it('un cambio solo de formato en el evaluador no cambia la huella', () => {
    const casos = CASOS['clasificar-respuesta'];
    expect(huellaDeEvals(plantilla, casos, 'f(a, b,\n)')).toBe(
      huellaDeEvals(plantilla, casos, 'f(a,b)'),
    );
    expect(huellaDeEvals(plantilla, casos, '/** doc */\nf(a); // nota')).toBe(
      huellaDeEvals(plantilla, casos, 'f(a);'),
    );
  });
  it('la huella cambia si cambia un caso o el evaluador', () => {
    const casos = CASOS['clasificar-respuesta'];
    const h = huellaDeEvals(plantilla, casos, 'evaluador');
    expect(huellaDeEvals(plantilla, casos.slice(1), 'evaluador')).not.toBe(h);
    expect(huellaDeEvals(plantilla, casos, 'evaluador relajado')).not.toBe(h);
  });
});
