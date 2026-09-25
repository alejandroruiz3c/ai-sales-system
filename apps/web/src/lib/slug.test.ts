import { describe, expect, it } from 'vitest';

import { LARGO_MAXIMO_DE_SLUG, slugConSufijo, slugDesdeNombre } from './slug.ts';

describe('slugDesdeNombre', () => {
  it('quita acentos y eñes en vez de borrarlas', () => {
    expect(slugDesdeNombre('Compañía Ibérica Demo')).toBe('compania-iberica-demo');
  });

  it('colapsa los separadores y no deja guiones sueltos en los extremos', () => {
    expect(slugDesdeNombre('  ¡¡ Hola  ·  Mundo !! ')).toBe('hola-mundo');
  });

  it('respeta el límite de la columna y no acaba en guion', () => {
    const largo = slugDesdeNombre('a'.repeat(30) + ' ' + 'b'.repeat(40));
    expect(largo.length).toBeLessThanOrEqual(50);
    expect(largo.endsWith('-')).toBe(false);
  });

  it('un nombre que solo tiene símbolos no da slug, y quien llama tiene que verlo', () => {
    expect(slugDesdeNombre('··· ¿? ···')).toBe('');
  });

  it('lo que devuelve casa con el check de la columna `slug`', () => {
    const patron = /^[a-z0-9]([a-z0-9-]{0,47}[a-z0-9])?$/;
    for (const nombre of [
      'Clínica Demo',
      'Logística Norte Demo',
      'ACME 2026',
      'Über Prüfung GmbH',
      'x',
    ]) {
      expect(patron.test(slugDesdeNombre(nombre)), `${nombre} -> ${slugDesdeNombre(nombre)}`).toBe(
        true,
      );
    }
  });
});

describe('slugConSufijo', () => {
  const VALIDO = /^[a-z0-9]([a-z0-9-]{0,47}[a-z0-9])?$/;

  it('con un nombre largo, cabe en el check de la tabla tenants', () => {
    const slug = slugConSufijo(
      'E2E F2 Sin Presupuesto Demo 1790331957327753 con más texto',
      'mg0x7k2a',
    );
    expect(slug.length).toBeLessThanOrEqual(LARGO_MAXIMO_DE_SLUG);
    expect(slug).toMatch(VALIDO);
    expect(slug.endsWith('-mg0x7k2a')).toBe(true);
  });

  it('con un nombre corto, no recorta', () => {
    expect(slugConSufijo('Aurora Demo', 'x1')).toBe('aurora-demo-x1');
  });
});
