import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { extraerJson, mensajeDeCorreccion, validarSalida } from './salida.ts';

const esquema = z.object({ categoria: z.enum(['SI', 'NO']), nota: z.string().min(1) });

describe('extraerJson', () => {
  it('lee JSON puro, dentro de un bloque de código o con una frase delante', () => {
    expect(extraerJson('{"a":1}')).toEqual({ a: 1 });
    expect(extraerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('Aquí va: {"a":1}')).toEqual({ a: 1 });
  });

  it('no repara un JSON roto', () => {
    expect(() => extraerJson('{"a":')).toThrow();
    expect(() => extraerJson('sin json')).toThrow();
  });
});

describe('validarSalida (F2.4)', () => {
  it('devuelve los datos tipados cuando valida', () => {
    expect(validarSalida('{"categoria":"SI","nota":"ok"}', esquema)).toEqual({
      valida: true,
      datos: { categoria: 'SI', nota: 'ok' },
    });
  });

  it('un valor fuera del enum no entra, y el error dice qué campo', () => {
    const r = validarSalida('{"categoria":"QUIZA","nota":"x"}', esquema);
    expect(r.valida).toBe(false);
    if (!r.valida) expect(r.errores.join(' ')).toMatch(/categoria/);
  });

  it('un texto que no es JSON es un fallo, no una excepción', () => {
    const r = validarSalida('lo siento, no puedo', esquema);
    expect(r.valida).toBe(false);
    if (!r.valida) expect(r.errores[0]).toMatch(/No es JSON/);
  });

  it('el mensaje de corrección lleva los errores concretos', () => {
    expect(mensajeDeCorreccion(['categoria: valor no válido'])).toContain(
      'categoria: valor no válido',
    );
  });
});
