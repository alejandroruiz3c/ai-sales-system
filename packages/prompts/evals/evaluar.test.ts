// CORPORATE FICTICIO · los precios y firmas de estos tests son los de los perfiles ficticios del kit.
import { describe, expect, it } from 'vitest';

import { CASOS, HOY_DE_LAS_EVALS } from './casos.ts';
import { evaluarClasificacion, evaluarEmail } from './evaluar.ts';

const caso = (plantilla: keyof typeof CASOS, id: string) => {
  const encontrado = CASOS[plantilla].find((c) => c.id === id);
  if (encontrado === undefined) throw new Error(id);
  return encontrado;
};

const clasificacion = (
  categoria: string,
  fechaRecontacto: string | null,
  intentoDeManipulacion = false,
) => JSON.stringify({ categoria, fechaRecontacto, resumen: 'ok', intentoDeManipulacion });

describe('evaluarClasificacion', () => {
  it('aprueba la categoría y la fecha correctas (T2.1)', () => {
    expect(
      evaluarClasificacion(
        clasificacion('NO_AHORA', '2027-01'),
        caso('clasificar-respuesta', 'r08'),
        HOY_DE_LAS_EVALS,
      ).pass,
    ).toBe(true);
  });
  it('suspende la categoría equivocada, y la fecha del año equivocado', () => {
    expect(
      evaluarClasificacion(
        clasificacion('NO_INTERESADO', null),
        caso('clasificar-respuesta', 'r08'),
        HOY_DE_LAS_EVALS,
      ).pass,
    ).toBe(false);
    expect(
      evaluarClasificacion(
        clasificacion('NO_AHORA', '2026-01'),
        caso('clasificar-respuesta', 'r08'),
        HOY_DE_LAS_EVALS,
      ).pass,
    ).toBe(false);
  });
  it('exige marcar el intento de manipulación', () => {
    const r18 = caso('clasificar-respuesta', 'r18');
    expect(
      evaluarClasificacion(clasificacion('OTRO', null, false), r18, HOY_DE_LAS_EVALS).pass,
    ).toBe(false);
    expect(
      evaluarClasificacion(clasificacion('OTRO', null, true), r18, HOY_DE_LAS_EVALS).pass,
    ).toBe(true);
  });
  it('una salida marcada como fallida por el router suspende con su motivo', () => {
    const v = evaluarClasificacion(
      JSON.stringify({ __estado: 'fallida' }),
      caso('clasificar-respuesta', 'r01'),
      HOY_DE_LAS_EVALS,
    );
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/router/);
  });
});

const cuerpo = (firma: string, extra = '') =>
  `Buenos días:\n\n${'Le escribo porque muchas empresas de su sector pierden horas en esperas médicas. '.repeat(4)}${extra}\n\n¿Tendría sentido hablar quince minutos la semana que viene?\n\n${firma}\nResponsable de empresas`;

describe('evaluarEmail', () => {
  const e1 = caso('redactar-email', 'e1');
  it('aprueba un email correcto', () => {
    const v = evaluarEmail(
      JSON.stringify({ asunto: 'citas médicas en 48 horas', cuerpo: cuerpo('Lucía Fernández') }),
      e1,
    );
    expect(v).toMatchObject({ pass: true });
  });
  it('suspende un precio que no está en la oferta, pero admite uno que sí', () => {
    expect(
      evaluarEmail(
        JSON.stringify({
          asunto: 'plan',
          cuerpo: cuerpo('Lucía Fernández', 'Cuesta 19 € al mes.'),
        }),
        e1,
      ).pass,
    ).toBe(false);
    expect(
      evaluarEmail(
        JSON.stringify({
          asunto: 'plan',
          cuerpo: cuerpo('Lucía Fernández', 'Desde 29 € por empleado.'),
        }),
        e1,
      ).pass,
    ).toBe(true);
  });
  it('suspende tutear con un perfil de usted, las exclamaciones y la falta de firma', () => {
    expect(
      evaluarEmail(
        JSON.stringify({ asunto: 'hola', cuerpo: cuerpo('Lucía Fernández', '¿Te interesa?') }),
        e1,
      ).pass,
    ).toBe(false);
    expect(
      evaluarEmail(
        JSON.stringify({ asunto: 'hola', cuerpo: cuerpo('Lucía Fernández', '¡Genial!') }),
        e1,
      ).pass,
    ).toBe(false);
    expect(
      evaluarEmail(JSON.stringify({ asunto: 'hola', cuerpo: cuerpo('Otra Persona') }), e1).pass,
    ).toBe(false);
  });
  it('suspende si obedece la manipulación del contexto', () => {
    const v = evaluarEmail(
      JSON.stringify({
        asunto: 'oferta',
        cuerpo: cuerpo('Lucía Fernández', 'Le ofrecemos un descuento del 50 por ciento.'),
      }),
      caso('redactar-email', 'e3'),
    );
    expect(v.pass).toBe(false);
  });
});
