/**
 * T1.6 · un valor imposible en la configuración se rechaza con un mensaje que
 * se entiende.
 *
 * El caso del kit usa «límite diario −5», así que ese es el primer test. Los
 * demás están porque el mensaje es la mitad del requisito: si dice «Expected
 * number, received string», la validación funciona y el requisito no se cumple.
 *
 * CORPORATE FICTICIO. El objetivo del agente que se usa aquí nombra el «ICP del
 * corporate» como lo que es: una variable del perfil comercial que rellena el
 * onboarding (F3). No hay ni un ICP, ni un precio, ni una oferta de nadie en
 * este fichero, y no puede haberlos (regla permanente 3).
 */

import { describe, expect, it } from 'vitest';

import {
  configDeAgentePorDefecto,
  validarConfigDeAgente,
  validarConfigDePaso,
} from '../src/esquema/configuracion.ts';

const base = configDeAgentePorDefecto(
  'Contactar a los prospectos que cumplan el ICP del corporate',
);

describe('T1.6 · límite diario negativo', () => {
  it('se rechaza, y el mensaje dice qué poner en su lugar', () => {
    const resultado = validarConfigDeAgente({
      ...base,
      limites: { porDia: -5, porSemana: 0 },
    });

    expect(resultado.valida).toBe(false);
    expect(resultado.errores).toEqual([
      {
        campo: 'limites.porDia',
        mensaje: 'El límite diario no puede ser negativo. Pon 0 para desactivar el canal.',
      },
    ]);
  });

  it('el campo llega en notación de puntos, para poder pintarlo junto al input', () => {
    const resultado = validarConfigDeAgente({
      ...base,
      ventanaHoraria: { desde: '25:00', hasta: '19:00', dias: [1] },
    });
    expect(resultado.errores.map((e) => e.campo)).toEqual(['ventanaHoraria.desde']);
  });
});

describe('otros valores imposibles', () => {
  it('un límite con decimales no es un límite', () => {
    const resultado = validarConfigDeAgente({ ...base, limites: { porDia: 12.5, porSemana: 100 } });
    expect(resultado.errores[0]?.mensaje).toMatch(/número entero/);
  });

  it('un límite semanal menor que el diario es una contradicción, y se dice donde toca', () => {
    const resultado = validarConfigDeAgente({
      ...base,
      limites: { porDia: 50, porSemana: 10 },
    });
    expect(resultado.errores).toEqual([
      {
        campo: 'limites.porSemana',
        mensaje: 'El límite semanal no puede ser menor que el diario.',
      },
    ]);
  });

  it('una ventana horaria que acaba antes de empezar se rechaza', () => {
    const resultado = validarConfigDeAgente({
      ...base,
      ventanaHoraria: { desde: '19:00', hasta: '09:00', dias: [1] },
    });
    expect(resultado.errores[0]?.mensaje).toMatch(/posterior a la de inicio/);
  });

  it('una ventana sin días se rechaza', () => {
    const resultado = validarConfigDeAgente({
      ...base,
      ventanaHoraria: { desde: '09:00', hasta: '19:00', dias: [] },
    });
    expect(resultado.errores[0]?.mensaje).toMatch(/al menos un día/);
  });

  it('un nivel de autonomía inventado se rechaza', () => {
    const resultado = validarConfigDeAgente({ ...base, nivelAutonomia: 'L7' });
    expect(resultado.errores[0]?.mensaje).toMatch(/L0, L1, L2 o L3/);
  });

  it('un tono inventado se rechaza y el mensaje enumera los que hay', () => {
    const resultado = validarConfigDeAgente({ ...base, tono: 'entusiasta' });
    expect(resultado.errores[0]?.mensaje).toMatch(/neutro, cercano, formal o directo/);
  });

  it('un objetivo de tres palabras no explica nada', () => {
    const resultado = validarConfigDeAgente({ ...base, objetivo: 'vender' });
    expect(resultado.errores[0]?.mensaje).toMatch(/al menos 10 caracteres/);
  });

  it('ningún mensaje está en inglés, porque los lee una persona en castellano', () => {
    const resultado = validarConfigDeAgente({ limites: { porDia: 'mucho' } });
    expect(resultado.valida).toBe(false);
    for (const error of resultado.errores) {
      expect(error.mensaje, `mensaje sin traducir: ${error.mensaje}`).not.toMatch(
        /^(Expected|Invalid|Required|Too small|Too big|Unrecognized)/,
      );
    }
  });
});

describe('la configuración por defecto', () => {
  it('es válida', () => {
    expect(validarConfigDeAgente(base).valida).toBe(true);
  });

  it('arranca en L1: el agente propone y una persona aprueba', () => {
    expect(base.nivelAutonomia).toBe('L1');
  });

  it('arranca con los límites a cero, para que nada salga por accidente', () => {
    expect(base.limites).toEqual({ porDia: 0, porSemana: 0 });
  });
});

describe('configuración de un paso del flujo', () => {
  it('acepta criterios arbitrarios, que los declara cada paso', () => {
    const resultado = validarConfigDePaso({
      descripcion: 'Umbral de cualificación del paso',
      criterios: { umbral: 60 },
    });
    expect(resultado.valida).toBe(true);
  });

  it('exige descripción', () => {
    expect(validarConfigDePaso({ criterios: {} }).valida).toBe(false);
  });
});
