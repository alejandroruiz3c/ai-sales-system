/**
 * El agente de prueba, que es el que usan T1.7, T1.8 y T1.9.
 *
 * Los tests del nivel de autonomía son los que valen: describen una regla que
 * se puede escribir antes de implementarla y fallarían si alguien la rompiera.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIG_POR_DEFECTO,
  COSTE_POR_LLAMADA_EUR,
  decidirDestino,
  esquemaConfigDePrueba,
  generarAccionDePrueba,
  type ConfigDePrueba,
} from './index.ts';

const con = (parcial: Partial<ConfigDePrueba>): ConfigDePrueba => ({
  ...CONFIG_POR_DEFECTO,
  ...parcial,
});

describe('T1.9 · el nivel de autonomía decide si la acción sale', () => {
  it('L0 genera y no envía, con cualquier límite y cualquier historial', () => {
    for (const enviadas of [0, 5, 1000]) {
      expect(decidirDestino(con({ nivelAutonomia: 'L0', limiteDiario: 100 }), enviadas).tipo).toBe(
        'solo-generar',
      );
    }
  });

  it('L1 pide aprobación, que es lo que hace útil la cola', () => {
    expect(decidirDestino(con({ nivelAutonomia: 'L1' }), 0).tipo).toBe('pedir-aprobacion');
  });

  it('L2 envía dentro del límite', () => {
    expect(decidirDestino(con({ nivelAutonomia: 'L2', limiteDiario: 3 }), 2).tipo).toBe('enviar');
  });

  it('L2 deja de enviar al llegar al límite, y no pide permiso en su lugar', () => {
    const destino = decidirDestino(con({ nivelAutonomia: 'L2', limiteDiario: 3 }), 3);
    expect(destino.tipo).toBe('solo-generar');
    // Convertir el tope en una petición de permiso lo volvería una molestia
    // que alguien acabaría aprobando por costumbre.
    expect(destino.tipo).not.toBe('pedir-aprobacion');
    expect(destino.motivo).toMatch(/límite diario alcanzado/i);
  });

  it('L2 con límite cero no envía nunca', () => {
    expect(decidirDestino(con({ nivelAutonomia: 'L2', limiteDiario: 0 }), 0).tipo).toBe(
      'solo-generar',
    );
  });

  it('L3 envía sin mirar el límite del nivel', () => {
    expect(decidirDestino(con({ nivelAutonomia: 'L3', limiteDiario: 1 }), 999).tipo).toBe('enviar');
  });

  it('bajar de L1 a L0 cambia el destino de la misma acción', () => {
    // Es literalmente el caso T1.9: «las acciones de prueba se generan pero no
    // se envían».
    const entrada = { nota: 'la misma acción', enviadasHoy: 0 };
    const enL1 = generarAccionDePrueba({ ...entrada, config: con({ nivelAutonomia: 'L1' }) });
    const enL0 = generarAccionDePrueba({ ...entrada, config: con({ nivelAutonomia: 'L0' }) });

    expect(enL1.destino.tipo).toBe('pedir-aprobacion');
    expect(enL0.destino.tipo).toBe('solo-generar');
    expect(enL0.contenido).toContain('la misma acción');
  });
});

describe('lo que genera', () => {
  it('cambia con el tono, que es lo que comprueba T1.5 sobre la configuración', () => {
    const neutro = generarAccionDePrueba({ config: con({ tono: 'neutro' }) }).contenido;
    const cercano = generarAccionDePrueba({ config: con({ tono: 'cercano' }) }).contenido;
    expect(neutro).not.toBe(cercano);
  });

  it('lleva la nota de quien la pidió, para reconocer su propia prueba', () => {
    const accion = generarAccionDePrueba({ config: CONFIG_POR_DEFECTO, nota: 'prueba de Alex' });
    expect(accion.contenido).toContain('prueba de Alex');
  });

  it('no contiene ni un dato de negocio', () => {
    const accion = generarAccionDePrueba({ config: CONFIG_POR_DEFECTO });
    for (const prohibido of ['€', 'precio', 'oferta', 'cliente', 'ICP']) {
      expect(accion.contenido.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
  });

  it('el reloj entra por parámetro: el agente no conoce su runtime', () => {
    const fija = new Date('2026-01-15T10:00:00.000Z');
    const accion = generarAccionDePrueba({ config: CONFIG_POR_DEFECTO, ahora: fija });
    expect(accion.contenido).toContain('2026-01-15T10:00:00.000Z');
  });
});

describe('el coste, que es lo que hace comprobable el caso T1.8', () => {
  it('cuesta 0,05 € por llamada', () => {
    expect(COSTE_POR_LLAMADA_EUR).toBe(0.05);
  });

  it('con un presupuesto de 0,50 € los umbrales caen en la 5, la 8 y la 10', () => {
    const limite = 0.5;
    const cruces: Record<number, number[]> = {};

    let gastado = 0;
    for (let llamada = 1; llamada <= 20; llamada += 1) {
      if (gastado >= limite) break;
      const antes = gastado;
      gastado = Number((gastado + COSTE_POR_LLAMADA_EUR).toFixed(6));
      for (const umbral of [50, 80, 100]) {
        const corte = (limite * umbral) / 100;
        if (antes < corte && gastado >= corte) {
          cruces[llamada] = [...(cruces[llamada] ?? []), umbral];
        }
      }
    }

    expect(cruces).toEqual({ 5: [50], 8: [80], 10: [100] });
  });
});

describe('su esquema de configuración', () => {
  it('acepta la configuración por defecto', () => {
    expect(esquemaConfigDePrueba.safeParse(CONFIG_POR_DEFECTO).success).toBe(true);
  });

  it('arranca en L1: propone y no envía sin que nadie lo vea', () => {
    expect(CONFIG_POR_DEFECTO.nivelAutonomia).toBe('L1');
  });

  it('rechaza un nivel inventado y un límite negativo', () => {
    expect(esquemaConfigDePrueba.safeParse(con({ nivelAutonomia: 'L9' as never })).success).toBe(
      false,
    );
    expect(esquemaConfigDePrueba.safeParse(con({ limiteDiario: -1 })).success).toBe(false);
  });
});
