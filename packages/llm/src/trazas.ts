/**
 * Trazas de cada llamada (F2.5): Langfuse, separado por tenant y por agente.
 *
 * El libro de gasto dice **cuánto** ha costado un tenant; la traza dice **qué**
 * se le pidió al modelo, qué respondió, cuántos intentos hicieron falta y si
 * hubo caché. Es lo que se abre cuando un agente escribe algo raro.
 *
 * Cuatro decisiones:
 *
 *   · **OpenTelemetry, no la API de ingesta.** La API de ingesta de Langfuse
 *     está obsoleta y se apaga en Langfuse Cloud el 16 de noviembre de 2026, y
 *     en las organizaciones creadas después del 16 de septiembre de 2026 ni
 *     siquiera se lee lo que escribe. Se envía OTLP en JSON a
 *     `/api/public/otel/v1/traces` con `fetch`, sin SDK: la misma llamada vale
 *     en una función de Vercel, en un worker y en un test.
 *   · **Una traza por llamada del router, una generación por intento.** Un
 *     reintento por salida malformada aparece como segunda generación dentro de
 *     la misma traza, que es donde hay que verlo.
 *   · **El tenant va como usuario** (`langfuse.user.id`) y el agente como
 *     nombre de la traza, más etiquetas `tenant:` y `agente:`. Así la vista de
 *     usuarios de Langfuse es directamente el coste por tenant, y el filtro por
 *     nombre, el coste por agente (caso T2.6).
 *   · **El contenido se redacta antes de salir**, con el mismo `redactar` que
 *     los logs: emails, teléfonos y documentos no llegan a Langfuse. A partir
 *     de F5 los prompts llevan datos de prospectos.
 *
 * Una traza que falla **no rompe la llamada**: el router captura el error y lo
 * avisa. Quedarse sin traza es un problema de observabilidad; perder la
 * respuesta del modelo después de haberla pagado sería un problema de verdad.
 */

import { createHash } from 'node:crypto';

import { redactar } from '@sales-os/core';

import type { Uso } from './coste.ts';
import type { Nivel } from './modelos.ts';

export interface IntentoTrazado {
  readonly numero: number;
  readonly modelo: string;
  readonly uso: Uso;
  readonly costeEur: number;
  readonly texto: string;
  readonly errores?: readonly string[];
  readonly inicio: Date;
  readonly fin: Date;
  readonly idDelProveedor?: string;
}

export type ResultadoTrazado = 'valida' | 'texto' | 'fallida' | 'bloqueada' | 'error';

export interface TrazaDeLlamada {
  readonly id: string;
  readonly tenantId: string;
  readonly agente: string;
  readonly tarea: string;
  readonly plantilla?: { readonly id: string; readonly version: string };
  readonly nivel: Nivel;
  readonly modelo: string;
  readonly proveedor: string;
  readonly modo: 'directo' | 'lote';
  readonly resultado: ResultadoTrazado;
  readonly intentos: readonly IntentoTrazado[];
  readonly costeEur: number;
  readonly uso: Uso;
  readonly cacheAcertada: boolean;
  readonly entrada: { readonly sistema: string; readonly mensaje: string };
  readonly salida: string;
  readonly motivo?: string;
  readonly inicio: Date;
  readonly fin: Date;
}

export interface Trazador {
  registrar(traza: TrazaDeLlamada): Promise<void>;
}

/** No traza nada. Para los tests y para cuando Langfuse no está configurado. */
export const TRAZADOR_NULO: Trazador = { registrar: () => Promise.resolve() };

/** Guarda las trazas en memoria, para los tests. */
export class TrazadorEnMemoria implements Trazador {
  readonly trazas: TrazaDeLlamada[] = [];
  registrar(traza: TrazaDeLlamada): Promise<void> {
    this.trazas.push(traza);
    return Promise.resolve();
  }
}

// ── Langfuse, por OpenTelemetry ──────────────────────────────────────────────

export interface ConfigLangfuse {
  readonly host: string;
  readonly clavePublica: string;
  readonly claveSecreta: string;
  /** Entorno que aparece en Langfuse, para no mezclar staging con previews. */
  readonly entorno: string;
  /** Inyectable en los tests. */
  readonly fetch?: typeof fetch;
}

/**
 * El identificador de traza de OpenTelemetry: 32 caracteres hexadecimales. El
 * router genera UUID, que son exactamente eso con guiones.
 */
export function idDeTrazaOtel(trazaId: string): string {
  const hex = trazaId.replaceAll('-', '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(hex)) return hex;
  return createHash('sha256').update(trazaId).digest('hex').slice(0, 32);
}

/** Identificador de span estable (16 hexadecimales): reenviar la traza no la duplica. */
function idDeSpan(trazaId: string, parte: string): string {
  return createHash('sha256').update(`${trazaId}:${parte}`).digest('hex').slice(0, 16);
}

type ValorOtel =
  | { readonly stringValue: string }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly boolValue: boolean }
  | { readonly arrayValue: { readonly values: readonly { readonly stringValue: string }[] } };

interface AtributoOtel {
  readonly key: string;
  readonly value: ValorOtel;
}

function atributo(key: string, valor: string | number | boolean | readonly string[]): AtributoOtel {
  if (Array.isArray(valor)) {
    return {
      key,
      value: { arrayValue: { values: valor.map((v: string) => ({ stringValue: v })) } },
    };
  }
  if (typeof valor === 'boolean') return { key, value: { boolValue: valor } };
  if (typeof valor === 'number') {
    return Number.isInteger(valor)
      ? { key, value: { intValue: String(valor) } }
      : { key, value: { doubleValue: valor } };
  }
  return { key, value: { stringValue: String(valor) } };
}

const nanos = (fecha: Date): string => `${String(fecha.getTime())}000000`;

export interface SpanOtel {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly AtributoOtel[];
  readonly status: { readonly code: 1 | 2; readonly message?: string };
}

/** El cuerpo OTLP/JSON de una traza. Puro, para poder probarlo. */
export function cuerpoOtelDeLangfuse(traza: TrazaDeLlamada, entorno: string) {
  const traceId = idDeTrazaOtel(traza.id);
  const raiz = idDeSpan(traza.id, 'raiz');
  const etiquetas = [
    `tenant:${traza.tenantId}`,
    `agente:${traza.agente}`,
    `tarea:${traza.tarea}`,
    `nivel:${traza.nivel}`,
    `modo:${traza.modo}`,
    ...(traza.cacheAcertada ? ['cache:acierto'] : []),
    ...(traza.intentos.length > 1 ? ['reintento'] : []),
    ...(traza.resultado === 'fallida' ? ['salida-invalida'] : []),
  ];
  const metadatos: Record<string, string | number | boolean> = {
    tenant_id: traza.tenantId,
    agente: traza.agente,
    tarea: traza.tarea,
    nivel: traza.nivel,
    proveedor: traza.proveedor,
    modo: traza.modo,
    resultado: traza.resultado,
    intentos: traza.intentos.length,
    cache_acertada: traza.cacheAcertada,
    coste_eur: traza.costeEur,
    moneda: 'EUR',
    router_traza_id: traza.id,
    ...(traza.plantilla === undefined
      ? {}
      : { plantilla: traza.plantilla.id, plantilla_version: traza.plantilla.version }),
    ...(traza.motivo === undefined ? {} : { motivo: traza.motivo }),
  };

  const spans: SpanOtel[] = [
    {
      traceId,
      spanId: raiz,
      name: traza.agente,
      kind: 1,
      startTimeUnixNano: nanos(traza.inicio),
      endTimeUnixNano: nanos(traza.fin),
      attributes: [
        atributo('langfuse.trace.name', traza.agente),
        atributo('langfuse.user.id', traza.tenantId),
        atributo('langfuse.trace.tags', etiquetas),
        atributo('langfuse.environment', entorno),
        ...Object.entries(metadatos).map(([k, v]) => atributo(`langfuse.trace.metadata.${k}`, v)),
        atributo('langfuse.observation.type', 'span'),
        atributo(
          'langfuse.observation.input',
          JSON.stringify({
            sistema: redactar(traza.entrada.sistema),
            mensaje: redactar(traza.entrada.mensaje),
          }),
        ),
        atributo('langfuse.observation.output', redactar(traza.salida)),
      ],
      status:
        traza.resultado === 'error' || traza.resultado === 'bloqueada'
          ? { code: 2, message: traza.motivo ?? traza.resultado }
          : { code: 1 },
    },
  ];

  for (const intento of traza.intentos) {
    spans.push({
      traceId,
      spanId: idDeSpan(traza.id, `intento-${String(intento.numero)}`),
      parentSpanId: raiz,
      name: `${traza.tarea} · intento ${String(intento.numero)}`,
      kind: 1,
      startTimeUnixNano: nanos(intento.inicio),
      endTimeUnixNano: nanos(intento.fin),
      attributes: [
        atributo('langfuse.observation.type', 'generation'),
        atributo('langfuse.observation.model.name', intento.modelo),
        atributo('langfuse.environment', entorno),
        atributo('langfuse.observation.output', redactar(intento.texto)),
        atributo(
          'langfuse.observation.usage_details',
          JSON.stringify({
            input: intento.uso.entrada,
            output: intento.uso.salida,
            cache_read_input_tokens: intento.uso.cacheLeida,
            cache_creation_input_tokens: intento.uso.cacheEscrita,
          }),
        ),
        // Langfuse no tiene moneda: pinta el importe con «$». El importe es en
        // euros, igual que en el libro de gasto; lo dice el metadato `moneda`.
        atributo('langfuse.observation.cost_details', JSON.stringify({ total: intento.costeEur })),
        atributo(
          'langfuse.observation.level',
          intento.errores === undefined ? 'DEFAULT' : 'WARNING',
        ),
        ...(intento.errores === undefined
          ? []
          : [
              atributo(
                'langfuse.observation.status_message',
                intento.errores.join(' · ').slice(0, 500),
              ),
            ]),
        ...(intento.idDelProveedor === undefined
          ? []
          : [atributo('langfuse.observation.metadata.id_proveedor', intento.idDelProveedor)]),
      ],
      status: { code: 1 },
    });
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            atributo('service.name', 'sales-os'),
            atributo('deployment.environment', entorno),
          ],
        },
        scopeSpans: [{ scope: { name: '@sales-os/llm' }, spans }],
      },
    ],
  };
}

export class TrazadorLangfuse implements Trazador {
  private readonly config: ConfigLangfuse;
  private readonly fetch: typeof fetch;

  constructor(config: ConfigLangfuse) {
    this.config = config;
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async registrar(traza: TrazaDeLlamada): Promise<void> {
    const credencial = Buffer.from(
      `${this.config.clavePublica}:${this.config.claveSecreta}`,
    ).toString('base64');
    const respuesta = await this.fetch(
      `${this.config.host.replace(/\/$/, '')}/api/public/otel/v1/traces`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${credencial}`,
          'x-langfuse-ingestion-version': '4',
        },
        body: JSON.stringify(cuerpoOtelDeLangfuse(traza, this.config.entorno)),
      },
    );
    if (!respuesta.ok) {
      throw new Error(`Langfuse ha respondido ${String(respuesta.status)} a la traza ${traza.id}.`);
    }
    // OTLP responde 200 con `partialSuccess` cuando rechaza parte de los spans:
    // un 200 no significa que la traza haya entrado entera.
    const cuerpo: unknown = await respuesta.json().catch(() => undefined);
    if (typeof cuerpo === 'object' && cuerpo !== null && 'partialSuccess' in cuerpo) {
      const parcial = cuerpo.partialSuccess;
      const rechazados =
        typeof parcial === 'object' && parcial !== null && 'rejectedSpans' in parcial
          ? Number(parcial.rejectedSpans)
          : 0;
      if (rechazados > 0) {
        throw new Error(
          `Langfuse ha rechazado ${String(rechazados)} span(s) de la traza ${traza.id}.`,
        );
      }
    }
  }
}
