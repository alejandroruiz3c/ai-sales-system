import { describe, expect, it } from 'vitest';

import { eventosDeLangfuse, TrazadorLangfuse, type TrazaDeLlamada } from './trazas.ts';

const inicio = new Date('2026-09-25T10:00:00.000Z');
const traza: TrazaDeLlamada = {
  id: 'traza-1',
  tenantId: 'tenant-a',
  agente: 'prueba',
  tarea: 'redactar-email',
  plantilla: { id: 'redactar-email', version: '1.abc' },
  nivel: 'medio',
  modelo: 'claude-sonnet-5',
  proveedor: 'anthropic',
  modo: 'directo',
  resultado: 'valida',
  intentos: [
    {
      numero: 1,
      modelo: 'claude-sonnet-5',
      uso: { entrada: 100, salida: 50, cacheEscrita: 0, cacheLeida: 900 },
      costeEur: 0.0012,
      texto: 'respuesta',
      inicio,
      fin: inicio,
    },
  ],
  costeEur: 0.0012,
  uso: { entrada: 100, salida: 50, cacheEscrita: 0, cacheLeida: 900 },
  cacheAcertada: true,
  entrada: {
    sistema: 'sistema',
    mensaje: 'Escribe a marta.garcia@ejemplo.test, teléfono 612 345 678',
  },
  salida: 'respuesta',
  inicio,
  fin: inicio,
};

describe('eventosDeLangfuse (T2.6)', () => {
  const eventos = eventosDeLangfuse(traza, 'staging');
  const cuerpo = eventos[0]?.body ?? {};

  it('el tenant es el usuario de Langfuse y el agente el nombre de la traza', () => {
    expect(eventos[0]?.type).toBe('trace-create');
    expect(cuerpo['userId']).toBe('tenant-a');
    expect(cuerpo['name']).toBe('prueba');
    expect(cuerpo['environment']).toBe('staging');
    expect(cuerpo['tags']).toEqual(
      expect.arrayContaining(['tenant:tenant-a', 'agente:prueba', 'cache:acierto']),
    );
  });

  it('una generación por intento, con uso de caché y coste', () => {
    const generacion = eventos[1]?.body ?? {};
    expect(eventos[1]?.type).toBe('generation-create');
    expect(generacion['traceId']).toBe('traza-1');
    expect(generacion['usageDetails']).toMatchObject({ cache_read_input_tokens: 900 });
    expect(generacion['costDetails']).toEqual({ total: 0.0012 });
  });

  it('los datos personales se redactan antes de salir hacia Langfuse', () => {
    const entrada = JSON.stringify(cuerpo['input']);
    expect(entrada).not.toContain('marta.garcia@ejemplo.test');
    expect(entrada).not.toContain('612 345 678');
  });
});

describe('TrazadorLangfuse', () => {
  it('envía a la API de ingesta con autenticación básica', async () => {
    const llamadas: { url: string; init: RequestInit | undefined }[] = [];
    const trazador = new TrazadorLangfuse({
      host: 'https://langfuse.test/',
      clavePublica: 'pk',
      claveSecreta: 'sk',
      entorno: 'test',
      fetch: (url, init) => {
        llamadas.push({ url: url instanceof Request ? url.url : url.toString(), init });
        return Promise.resolve(
          new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 }),
        );
      },
    });
    await trazador.registrar(traza);
    expect(llamadas[0]?.url).toBe('https://langfuse.test/api/public/ingestion');
    expect(new Headers(llamadas[0]?.init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('pk:sk').toString('base64')}`,
    );
  });

  it('un 207 con eventos rechazados es un fallo, no un éxito', async () => {
    const trazador = new TrazadorLangfuse({
      host: 'https://langfuse.test',
      clavePublica: 'pk',
      claveSecreta: 'sk',
      entorno: 'test',
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ successes: [], errors: [{ id: 'x', status: 400 }] }), {
            status: 207,
          }),
        ),
    });
    await expect(trazador.registrar(traza)).rejects.toThrow(/rechazado/);
  });
});
