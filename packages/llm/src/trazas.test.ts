import { describe, expect, it } from 'vitest';

import {
  cuerpoOtelDeLangfuse,
  idDeTrazaOtel,
  TrazadorLangfuse,
  type TrazaDeLlamada,
} from './trazas.ts';

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

type Atributos = readonly { key: string; value: Record<string, unknown> }[];

function valor(atributos: Atributos, clave: string): unknown {
  const v = atributos.find((a) => a.key === clave)?.value;
  if (v === undefined) return undefined;
  if ('arrayValue' in v) {
    return (v['arrayValue'] as { values: { stringValue: string }[] }).values.map(
      (x) => x.stringValue,
    );
  }
  return Object.values(v)[0];
}

describe('cuerpoOtelDeLangfuse (T2.6)', () => {
  const cuerpo = cuerpoOtelDeLangfuse(
    { ...traza, id: '11111111-2222-4333-8444-555555555555' },
    'staging',
  );
  const spans = cuerpo.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
  const raiz = spans[0];
  const generacion = spans[1];

  it('una traza OTel con el tenant como usuario y el agente como nombre', () => {
    expect(raiz?.traceId).toBe('11111111222243338444555555555555');
    expect(valor(raiz?.attributes ?? [], 'langfuse.user.id')).toBe('tenant-a');
    expect(valor(raiz?.attributes ?? [], 'langfuse.trace.name')).toBe('prueba');
    expect(valor(raiz?.attributes ?? [], 'langfuse.environment')).toBe('staging');
    expect(valor(raiz?.attributes ?? [], 'langfuse.trace.tags')).toEqual(
      expect.arrayContaining(['tenant:tenant-a', 'agente:prueba', 'cache:acierto']),
    );
  });

  it('una generación por intento, hija de la raíz, con modelo, caché y coste', () => {
    expect(spans).toHaveLength(2);
    expect(generacion?.parentSpanId).toBe(raiz?.spanId);
    const atributos = generacion?.attributes ?? [];
    expect(valor(atributos, 'langfuse.observation.type')).toBe('generation');
    expect(valor(atributos, 'langfuse.observation.model.name')).toBe('claude-sonnet-5');
    expect(
      JSON.parse(String(valor(atributos, 'langfuse.observation.usage_details'))),
    ).toMatchObject({
      cache_read_input_tokens: 900,
    });
    expect(JSON.parse(String(valor(atributos, 'langfuse.observation.cost_details')))).toEqual({
      total: 0.0012,
    });
  });

  it('los identificadores son estables: reenviar la misma traza no la duplica', () => {
    const otra = cuerpoOtelDeLangfuse(
      { ...traza, id: '11111111-2222-4333-8444-555555555555' },
      'staging',
    );
    expect(otra.resourceSpans[0]?.scopeSpans[0]?.spans.map((x) => x.spanId)).toEqual(
      spans.map((x) => x.spanId),
    );
  });

  it('los datos personales se redactan antes de salir hacia Langfuse', () => {
    const entrada = String(valor(raiz?.attributes ?? [], 'langfuse.observation.input'));
    expect(entrada).not.toContain('marta.garcia@ejemplo.test');
    expect(entrada).not.toContain('612 345 678');
  });

  it('un id que no es UUID da igualmente un id de traza válido', () => {
    expect(idDeTrazaOtel('no-es-un-uuid')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('TrazadorLangfuse', () => {
  it('envía OTLP en JSON al endpoint de OpenTelemetry con autenticación básica', async () => {
    const llamadas: { url: string; init: RequestInit | undefined }[] = [];
    const trazador = new TrazadorLangfuse({
      host: 'https://langfuse.test/',
      clavePublica: 'pk',
      claveSecreta: 'sk',
      entorno: 'test',
      fetch: (url, init) => {
        llamadas.push({ url: url instanceof Request ? url.url : url.toString(), init });
        return Promise.resolve(new Response('{}', { status: 200 }));
      },
    });
    await trazador.registrar(traza);
    expect(llamadas[0]?.url).toBe('https://langfuse.test/api/public/otel/v1/traces');
    const cabeceras = new Headers(llamadas[0]?.init?.headers);
    expect(cabeceras.get('authorization')).toBe(`Basic ${Buffer.from('pk:sk').toString('base64')}`);
    expect(cabeceras.get('x-langfuse-ingestion-version')).toBe('4');
  });

  it('un 200 con spans rechazados es un fallo, no un éxito', async () => {
    const trazador = new TrazadorLangfuse({
      host: 'https://langfuse.test',
      clavePublica: 'pk',
      claveSecreta: 'sk',
      entorno: 'test',
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: 'x' } }),
            { status: 200 },
          ),
        ),
    });
    await expect(trazador.registrar(traza)).rejects.toThrow(/rechazado/);
  });
});
