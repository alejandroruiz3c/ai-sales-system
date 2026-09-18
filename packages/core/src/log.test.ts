import { describe, expect, it, vi } from 'vitest';

import { crearLogger, redactar, redactarCampos, type LogEntry } from './log.ts';

const BASE = {
  service: 'web',
  environment: 'staging',
  version: '0.0.0+abc1234',
  now: () => new Date('2026-09-18T10:00:00.000Z'),
} as const;

describe('redactar', () => {
  it('quita emails, que es el dato personal que de verdad acaba en un log', () => {
    expect(redactar('rebote de maria.perez+ventas@ejemplo-ficticio.com')).toBe('rebote de [email]');
  });

  it('quita teléfonos en los formatos que llegan de un CRM, enteros', () => {
    const telefonos = [
      '+34 612 34 56 78',
      '612345678',
      '(91) 123 45 67',
      '+34612345678',
      '912 34 56 78',
      '+1 (415) 555-2671',
      '612-34-56-78',
    ];
    for (const telefono of telefonos) {
      // Entero, no a medias: «+34 [telefono] 78» sigue siendo un teléfono.
      expect(redactar(`llamada a ${telefono}`), telefono).toBe('llamada a [telefono]');
    }
  });

  it('no confunde con un teléfono un número técnico ni una fecha', () => {
    const inocentes = [
      'reintento 2 de 3 tras HTTP 429 en /api/inngest (120 ms)',
      'generado 2026-09-18T10:00:00.000Z en 45 ms',
      'ventana 2026-09-18 10:00 a 2026-09-19 10:00',
      'version 0.0.0+abc1234',
      'commit f3f4f03 desplegado',
      'lote de 1000 prospectos en 25000 ms',
      'presupuesto 12,50 EUR de 100 EUR',
    ];
    for (const texto of inocentes) {
      expect(redactar(texto), texto).toBe(texto);
    }
  });

  it('quita documentos de identidad y perfiles de LinkedIn', () => {
    expect(redactar('el decisor 12345678Z')).toBe('el decisor [documento]');
    expect(redactar('perfil https://www.linkedin.com/in/alguien-ficticio')).toBe(
      'perfil [perfil-linkedin]',
    );
  });

  it('quita secretos, porque un log es un sitio desde el que se filtra', () => {
    // Los secretos de mentira se ensamblan en dos trozos a propósito: escritos
    // de una pieza, el literal dispararía la regla de ESLint que veta secretos
    // en código, y esa regla tiene que seguir saltando en todas partes,
    // incluidos los tests, que es donde de verdad se cuela un secreto real.
    const falso = (prefijo: string, resto: string): string => `${prefijo}${resto}`;
    const casos = [
      falso('sk', '-abcdef123456'),
      falso('ghp', '_abcdefghij1234'),
      falso('sntryu', '_abcdefghij1234'),
      falso('sntrys', '_abcdefghij1234'),
      falso('signkey', '-prod-abcdef123456'),
      falso('sbp', '_abcdefghij1234'),
    ];
    for (const secreto of casos) {
      expect(redactar(`fallo con ${secreto}`), secreto).toBe('fallo con [secreto]');
    }
  });

  it('quita JWT completos', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MH0.ZmFsc28tZmFsc28tZmFsc28';
    expect(redactar(`token ${jwt}`)).toBe('token [jwt]');
  });

  it('no estropea un texto técnico normal', () => {
    const texto = 'reintento 2 de 3 tras HTTP 429 en /api/inngest (120 ms)';
    expect(redactar(texto)).toBe(texto);
  });
});

describe('redactarCampos', () => {
  it('redacta los valores de texto y deja los números y booleanos', () => {
    expect(
      redactarCampos({
        tenantId: 'tnt_123',
        destinatario: 'quien@ejemplo-ficticio.com',
        durationMs: 120,
        outcome: 'bloqueado',
        bloqueadoPorSandbox: true,
      }),
    ).toEqual({
      tenantId: 'tnt_123',
      destinatario: '[email]',
      durationMs: 120,
      outcome: 'bloqueado',
      bloqueadoPorSandbox: true,
    });
  });

  it('descarta los campos sin valor en vez de mandar null', () => {
    expect(redactarCampos({ nota: undefined, count: 0 })).toEqual({ count: 0 });
  });
});

describe('crearLogger', () => {
  it('sin configuración de Better Stack no envía nada, pero sigue dejando rastro local', () => {
    const escritas: LogEntry[] = [];
    const hacerFetch = vi.fn();
    const log = crearLogger({ ...BASE, sink: (e) => escritas.push(e), fetch: hacerFetch });

    log.info('arranque', { tenantId: 'tnt_1' });

    expect(log.activo).toBe(false);
    expect(hacerFetch).not.toHaveBeenCalled();
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.message).toBe('arranque');
    expect(escritas[0]!.environment).toBe('staging');
  });

  it('con configuración envía a la fuente y no filtra datos personales por el camino', async () => {
    const hacerFetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const log = crearLogger({
      ...BASE,
      sourceToken: 'tok_falso',
      ingestingHost: 'https://ingesta.ejemplo-ficticio.test/',
      fetch: hacerFetch,
      sink: () => undefined,
    });

    const resultado = await log.enviar(
      log.entrada('warn', 'rebote de quien@ejemplo-ficticio.com', {
        tenantId: 'tnt_1',
        telefono: '+34 612 34 56 78',
      }),
    );

    expect(resultado.enviado).toBe(true);
    const [url, init] = hacerFetch.mock.calls[0] as [string, RequestInit];
    // El esquema y la barra final del host se normalizan.
    expect(url).toBe('https://ingesta.ejemplo-ficticio.test/');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok_falso');

    const cuerpo = JSON.parse(init.body as string) as LogEntry;
    expect(cuerpo.message).toBe('rebote de [email]');
    expect(cuerpo.fields['telefono']).toBe('[telefono]');
    expect(cuerpo.fields['tenantId']).toBe('tnt_1');
    expect(cuerpo.dt).toBe('2026-09-18T10:00:00.000Z');
    // Lo importante: nada de lo enviado contiene el dato original.
    expect(init.body as string).not.toContain('ejemplo-ficticio.com');
    expect(init.body as string).not.toContain('612');
  });

  it('un 401 de la fuente se explica como token inválido, no como "error"', async () => {
    const log = crearLogger({
      ...BASE,
      sourceToken: 'tok_malo',
      ingestingHost: 'ingesta.ejemplo-ficticio.test',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
      sink: () => undefined,
    });
    const resultado = await log.enviar(log.entrada('info', 'latido'));
    expect(resultado.enviado).toBe(false);
    expect(resultado.detalle).toContain('token de la fuente no es válido');
  });

  it('si la ingesta falla, el log no revienta la petición que lo generó', async () => {
    const escritas: LogEntry[] = [];
    const log = crearLogger({
      ...BASE,
      sourceToken: 'tok',
      ingestingHost: 'ingesta.ejemplo-ficticio.test',
      fetch: vi.fn().mockRejectedValue(new Error('la red se ha caído')),
      sink: (e) => escritas.push(e),
    });

    expect(() => {
      log.error('algo ha fallado', { outcome: 'fallo' });
    }).not.toThrow();
    expect(escritas).toHaveLength(1);

    const resultado = await log.enviar(log.entrada('error', 'algo ha fallado'));
    expect(resultado.enviado).toBe(false);
    expect(resultado.detalle).toContain('la red se ha caído');
  });
});
