import { describe, expect, it } from 'vitest';

import {
  normalizeEmail,
  normalizeLinkedIn,
  parseAllowlist,
  parseAllowlistEntry,
  splitAllowlistValue,
} from './allowlist.ts';

describe('splitAllowlistValue', () => {
  it('acepta comas, punto y coma y saltos de línea', () => {
    expect(splitAllowlistValue('a@b.com, c@d.com;\n e@f.com ')).toEqual([
      'a@b.com',
      'c@d.com',
      'e@f.com',
    ]);
  });

  it('devuelve lista vacía si la variable no está definida', () => {
    expect(splitAllowlistValue(undefined)).toEqual([]);
    expect(splitAllowlistValue('')).toEqual([]);
  });
});

describe('parseAllowlistEntry', () => {
  it('reconoce email, dominio, teléfono, LinkedIn y social', () => {
    expect(parseAllowlistEntry('alex@turbineh.com')?.kind).toBe('email');
    expect(parseAllowlistEntry('@turbineh.com')?.kind).toBe('email-domain');
    expect(parseAllowlistEntry('+34600111222')?.kind).toBe('phone');
    expect(parseAllowlistEntry('https://linkedin.com/in/alguien')?.kind).toBe('linkedin');
    expect(parseAllowlistEntry('youtube:@canal')?.kind).toBe('social');
  });

  it('guarda la dirección base para que los alias con + coincidan', () => {
    expect(parseAllowlistEntry('alex.ruiz+t1@turbineh.com')?.value).toBe('alex.ruiz@turbineh.com');
  });

  it('descarta comentarios y entradas que no se entienden', () => {
    expect(parseAllowlistEntry('# los alias de Alex')).toBeNull();
    expect(parseAllowlistEntry('')).toBeNull();
    expect(parseAllowlistEntry('no es un destinatario')).toBeNull();
    expect(parseAllowlistEntry('600111222')).toBeNull(); // sin prefijo internacional
  });

  it('descarta un email mal formado', () => {
    expect(parseAllowlistEntry('alex@turbineh')).toBeNull();
    expect(parseAllowlistEntry('@@turbineh.com')).toBeNull();
    expect(parseAllowlistEntry('+t1@turbineh.com')).toBeNull();
  });
});

describe('parseAllowlist', () => {
  it('quita duplicados equivalentes', () => {
    const rules = parseAllowlist([
      'alex.ruiz@turbineh.com',
      'alex.ruiz+t1@turbineh.com',
      'ALEX.RUIZ@TURBINEH.COM',
    ]);
    expect(rules).toHaveLength(1);
  });
});

describe('normalizaciones', () => {
  it('normalizeEmail separa dirección completa y base', () => {
    expect(normalizeEmail('Alex.Ruiz+Lector@Turbineh.com')).toEqual({
      full: 'alex.ruiz+lector@turbineh.com',
      base: 'alex.ruiz@turbineh.com',
    });
  });

  it('normalizeLinkedIn extrae el identificador del perfil', () => {
    expect(normalizeLinkedIn('https://www.linkedin.com/in/Alex-Ruiz/?trk=x')).toBe('alex-ruiz');
    expect(normalizeLinkedIn('https://empresa.com/equipo')).toBeNull();
  });
});
