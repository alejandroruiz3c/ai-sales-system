/**
 * Trazas de cada llamada (F2.5): Langfuse, separado por tenant y por agente.
 *
 * El libro de gasto dice **cuánto** ha costado un tenant; la traza dice **qué**
 * se le pidió al modelo, qué respondió, cuántos intentos hicieron falta y si
 * hubo caché. Es lo que se abre cuando un agente escribe algo raro.
 *
 * Tres decisiones:
 *
 *   · **Una traza por llamada del router, una generación por intento.** Un
 *     reintento por salida malformada aparece como segunda generación dentro de
 *     la misma traza, que es donde hay que verlo.
 *   · **El tenant va como `userId`** y el agente como nombre de la traza, más
 *     etiquetas `tenant:` y `agente:`. Así la vista de usuarios de Langfuse es
 *     directamente el coste por tenant, y el filtro por nombre, el coste por
 *     agente (caso T2.6).
 *   · **El contenido se redacta antes de salir**, con el mismo `redactar` que
 *     los logs: emails, teléfonos y documentos no llegan a Langfuse. A partir
 *     de F5 los prompts llevan datos de prospectos.
 *
 * Una traza que falla **no rompe la llamada**: el router captura el error y lo
 * avisa. Quedarse sin traza es un problema de observabilidad; perder la
 * respuesta del modelo después de haberla pagado sería un problema de verdad.
 */

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

// ── Langfuse ─────────────────────────────────────────────────────────────────

export interface ConfigLangfuse {
  readonly host: string;
  readonly clavePublica: string;
  readonly claveSecreta: string;
  /** Entorno que aparece en Langfuse, para no mezclar staging con previews. */
  readonly entorno: string;
  /** Inyectable en los tests. */
  readonly fetch?: typeof fetch;
}

interface EventoDeIngesta {
  readonly id: string;
  readonly timestamp: string;
  readonly type: 'trace-create' | 'generation-create';
  readonly body: Record<string, unknown>;
}

/** Los eventos que se envían a la API de ingesta para una traza. Puro, para poder probarlo. */
export function eventosDeLangfuse(traza: TrazaDeLlamada, entorno: string): EventoDeIngesta[] {
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

  const metadatos = {
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
    ...(traza.plantilla === undefined
      ? {}
      : { plantilla: traza.plantilla.id, plantilla_version: traza.plantilla.version }),
    ...(traza.motivo === undefined ? {} : { motivo: traza.motivo }),
  };

  const eventos: EventoDeIngesta[] = [
    {
      id: `${traza.id}-t`,
      timestamp: traza.inicio.toISOString(),
      type: 'trace-create',
      body: {
        id: traza.id,
        name: traza.agente,
        userId: traza.tenantId,
        environment: entorno,
        tags: etiquetas,
        metadata: metadatos,
        input: {
          sistema: redactar(traza.entrada.sistema),
          mensaje: redactar(traza.entrada.mensaje),
        },
        output: redactar(traza.salida),
        timestamp: traza.inicio.toISOString(),
      },
    },
  ];

  for (const intento of traza.intentos) {
    eventos.push({
      id: `${traza.id}-g${String(intento.numero)}`,
      timestamp: intento.inicio.toISOString(),
      type: 'generation-create',
      body: {
        id: `${traza.id}-${String(intento.numero)}`,
        traceId: traza.id,
        name: `${traza.tarea} · intento ${String(intento.numero)}`,
        environment: entorno,
        startTime: intento.inicio.toISOString(),
        endTime: intento.fin.toISOString(),
        model: intento.modelo,
        output: redactar(intento.texto),
        level: intento.errores === undefined ? 'DEFAULT' : 'WARNING',
        ...(intento.errores === undefined
          ? {}
          : { statusMessage: intento.errores.join(' · ').slice(0, 500) }),
        usageDetails: {
          input: intento.uso.entrada,
          output: intento.uso.salida,
          cache_read_input_tokens: intento.uso.cacheLeida,
          cache_creation_input_tokens: intento.uso.cacheEscrita,
        },
        // Langfuse no tiene moneda: pinta el importe con «$». El importe es
        // en euros, igual que en el libro de gasto; lo dice `moneda`.
        costDetails: { total: intento.costeEur },
        metadata: {
          moneda: 'EUR',
          ...(intento.idDelProveedor === undefined ? {} : { id_proveedor: intento.idDelProveedor }),
        },
      },
    });
  }

  return eventos;
}

export class TrazadorLangfuse implements Trazador {
  private readonly fetch: typeof fetch;

  private readonly config: ConfigLangfuse;

  constructor(config: ConfigLangfuse) {
    this.config = config;
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async registrar(traza: TrazaDeLlamada): Promise<void> {
    const credencial = Buffer.from(
      `${this.config.clavePublica}:${this.config.claveSecreta}`,
    ).toString('base64');
    const respuesta = await this.fetch(
      `${this.config.host.replace(/\/$/, '')}/api/public/ingestion`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${credencial}` },
        body: JSON.stringify({ batch: eventosDeLangfuse(traza, this.config.entorno) }),
      },
    );
    if (!respuesta.ok) {
      throw new Error(`Langfuse ha respondido ${String(respuesta.status)} a la traza ${traza.id}.`);
    }
    // La ingesta responde 207 con los eventos que no ha aceptado: un 2xx no
    // significa que la traza haya entrado.
    const cuerpo: unknown = await respuesta.json().catch(() => undefined);
    if (typeof cuerpo === 'object' && cuerpo !== null && 'errors' in cuerpo) {
      const errores = cuerpo.errors;
      if (Array.isArray(errores) && errores.length > 0) {
        throw new Error(
          `Langfuse ha rechazado ${String(errores.length)} evento(s) de la traza ${traza.id}.`,
        );
      }
    }
  }
}
