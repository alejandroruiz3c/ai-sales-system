import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { elegirModelo } from '../modelos.ts';
import { PresupuestoEnMemoria } from '../presupuesto.ts';
import { crearRouter } from '../router.ts';
import { aParametrosDeAnthropic, ProveedorAnthropic } from './anthropic.ts';
import { ProveedorSimulado } from './simulado.ts';

const esquema = z.object({ categoria: z.enum(['SI', 'NO']) });

function peticion(nivel: 'ligero' | 'medio' | 'alto') {
  return {
    modelo: elegirModelo(nivel),
    sistema: [
      { texto: 'instrucciones', cachear: false },
      { texto: 'perfil', cachear: true },
    ],
    mensajes: [{ rol: 'usuario' as const, texto: 'hola' }],
    maxTokens: 100,
    esquema,
  };
}

/** Un cliente real del SDK con un `fetch` falso: prueba el mapeo sin red. */
function clienteFalso(respuesta: (cuerpo: Record<string, unknown>) => unknown) {
  const enviados: Record<string, unknown>[] = [];
  const cliente = new Anthropic({
    apiKey: 'clave-de-test',
    maxRetries: 0,
    fetch: (_url: string | URL | Request, init?: RequestInit) => {
      const texto = typeof init?.body === 'string' ? init.body : '{}';
      const cuerpo = JSON.parse(texto) as Record<string, unknown>;
      enviados.push(cuerpo);
      return Promise.resolve(
        new Response(JSON.stringify(respuesta(cuerpo)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  return { cliente, enviados };
}

function mensaje(texto: string, cacheLeida = 0) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: texto }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 40,
      output_tokens: 12,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cacheLeida,
    },
  };
}

describe('aParametrosDeAnthropic', () => {
  it('marca cache_control solo en el bloque que se cachea', () => {
    const p = aParametrosDeAnthropic(peticion('medio'));
    expect(p.system).toEqual([
      { type: 'text', text: 'instrucciones' },
      { type: 'text', text: 'perfil', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('pide la salida con forma JSON cuando hay esquema', () => {
    const p = aParametrosDeAnthropic(peticion('ligero'));
    expect(p.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(p.output_config?.format?.schema)).toContain('categoria');
  });

  it('no deja pensar de más: Haiku sin parámetros, Sonnet con thinking apagado, Opus 5.5 con esfuerzo bajo', () => {
    const haiku = aParametrosDeAnthropic(peticion('ligero'));
    expect(haiku.thinking).toBeUndefined();
    expect(haiku.output_config?.effort).toBeUndefined();

    expect(aParametrosDeAnthropic(peticion('medio')).thinking).toEqual({ type: 'disabled' });
    expect(aParametrosDeAnthropic(peticion('alto')).output_config?.effort).toBe('low');
  });
});

describe('ProveedorAnthropic', () => {
  it('traduce la respuesta y el uso, con la caché leída por separado', async () => {
    const { cliente, enviados } = clienteFalso(() => mensaje('{"categoria":"SI"}', 30));
    const proveedor = new ProveedorAnthropic({ cliente });
    const r = await proveedor.generar(peticion('ligero'));

    expect(r).toEqual({
      texto: '{"categoria":"SI"}',
      uso: { entrada: 40, salida: 12, cacheEscrita: 0, cacheLeida: 30 },
      motivoDeParada: 'fin',
      idDelProveedor: 'msg_test',
    });
    expect(enviados[0]?.['model']).toBe('claude-haiku-4-5-20251001');
  });

  it('un rechazo del modelo llega al router como error, sin lanzar', async () => {
    const { cliente } = clienteFalso(() => ({ ...mensaje(''), stop_reason: 'refusal' }));
    const router = crearRouter({
      proveedor: new ProveedorAnthropic({ cliente }),
      presupuesto: new PresupuestoEnMemoria(1),
      tipoCambioUsdEur: 0.93,
    });
    const r = await router.generar({
      tenantId: 't',
      agente: 'a',
      tarea: 'x',
      nivel: 'ligero',
      bloquesFijos: ['s'],
      mensaje: 'm',
      maxTokens: 10,
    });
    expect(r.estado).toBe('error');
  });
});

describe('ModelProvider es intercambiable (F2.8)', () => {
  it('el mismo router da el mismo resultado con el proveedor real que con el simulado', async () => {
    const texto = '{"categoria":"NO"}';
    const { cliente } = clienteFalso(() => mensaje(texto));
    const proveedores = [
      new ProveedorAnthropic({ cliente }),
      new ProveedorSimulado({ responder: () => texto }),
    ];

    const resultados = await Promise.all(
      proveedores.map((proveedor) =>
        crearRouter({
          proveedor,
          presupuesto: new PresupuestoEnMemoria(1),
          tipoCambioUsdEur: 0.93,
        }).generar({
          tenantId: 't',
          agente: 'a',
          tarea: 'clasificar',
          nivel: 'ligero',
          bloquesFijos: ['s'],
          mensaje: 'm',
          esquema,
          maxTokens: 50,
        }),
      ),
    );

    for (const r of resultados) {
      expect(r.estado).toBe('valida');
      if (r.estado === 'valida') expect(r.datos).toEqual({ categoria: 'NO' });
    }
  });
});
