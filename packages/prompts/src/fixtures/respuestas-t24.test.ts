import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CATEGORIAS_DE_RESPUESTA } from '../plantillas/clasificar-respuesta.ts';
import { recontactoCorrecto, RESPUESTAS_T24, respuestasT24ComoCsv } from './respuestas-t24.ts';

describe('respuestas de T2.4', () => {
  it('son 20, con identificador único, e incluyen las siete que fija el plan', () => {
    expect(RESPUESTAS_T24).toHaveLength(20);
    expect(new Set(RESPUESTAS_T24.map((r) => r.id)).size).toBe(20);
    const textos = RESPUESTAS_T24.map((r) => r.texto);
    for (const delPlan of [
      'Me interesa, ¿cuándo podemos hablar?',
      'Dadme de baja',
      'Estoy fuera hasta el 5 de octubre',
      '¿Cuánto cuesta?',
      'No gracias, ya tenemos proveedor',
      'Pásame info por email',
      '¿Quién os ha dado mi contacto?',
    ]) {
      expect(textos).toContain(delPlan);
    }
  });

  it('cubren todas las categorías', () => {
    expect(new Set(RESPUESTAS_T24.map((r) => r.categoria))).toEqual(
      new Set(CATEGORIAS_DE_RESPUESTA),
    );
  });

  it('el CSV entregado coincide con la lista (regenéralo con `pnpm fixtures:csv` si cambias un caso)', () => {
    const csv = readFileSync(new URL('./respuestas-t24.csv', import.meta.url), 'utf8');
    expect(csv).toBe(respuestasT24ComoCsv());
  });
});

describe('recontactoCorrecto', () => {
  const hoy = '2026-09-25';
  it('«en enero» en septiembre es enero del año siguiente', () => {
    expect(recontactoCorrecto('01', '2027-01', hoy)).toBe(true);
    expect(recontactoCorrecto('01', '2027-01-01', hoy)).toBe(true);
    expect(recontactoCorrecto('01', '2026-01', hoy)).toBe(false);
  });
  it('un día que aún no ha llegado es de este año', () => {
    expect(recontactoCorrecto('10-05', '2026-10-05', hoy)).toBe(true);
    expect(recontactoCorrecto('10-05', '2026-10', hoy)).toBe(false);
  });
  it('sin fecha esperada, solo vale null', () => {
    expect(recontactoCorrecto('', null, hoy)).toBe(true);
    expect(recontactoCorrecto('', '2026-10', hoy)).toBe(false);
  });
});
