/**
 * Proveedor de Anthropic: la única pieza del sistema que conoce el SDK.
 *
 * Traduce la petición neutra del router a la API de Mensajes y la respuesta de
 * vuelta, sin decidir nada. Lo que sí resuelve aquí es lo que depende de cómo
 * funciona esta API en concreto:
 *
 *   · **la caché** se pide con `cache_control` en el último bloque fijo del
 *     prompt de sistema. Todo lo que va antes queda cacheado;
 *   · **la forma de la salida** se fuerza con salidas estructuradas
 *     (`output_config.format`), así que un JSON mal formado es rarísimo. El
 *     router sigue validando con Zod, porque el esquema del proveedor no
 *     entiende todas las reglas del nuestro;
 *   · **el razonamiento** se apaga o se reduce según el modelo, porque se cobra
 *     como salida y en una clasificación no aporta nada.
 *
 * La clave entra por parámetro. Este fichero no lee `process.env` (CLAUDE.md
 * §1): quien construye el proveedor decide de dónde sale.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

import type { Uso } from '../coste.ts';
import type {
  EstadoDeLote,
  ModelProvider,
  MotivoDeParada,
  PeticionAlModelo,
  PeticionDeLote,
  ProveedorDeLotes,
  RespuestaDelModelo,
  ResultadoDePeticionDeLote,
  ResumenDeLote,
} from '../proveedor.ts';

export interface ConfigAnthropic {
  readonly apiKey: string;
  /** Tiempo máximo por llamada síncrona, en milisegundos. */
  readonly timeoutMs?: number;
}

type ParametrosDeMensaje = Anthropic.MessageCreateParamsNonStreaming;

/** La petición neutra, en el formato de la API de Mensajes. */
export function aParametrosDeAnthropic(peticion: PeticionAlModelo): ParametrosDeMensaje {
  const { modelo } = peticion;

  const system: Anthropic.TextBlockParam[] = peticion.sistema.map((bloque) => ({
    type: 'text',
    text: bloque.texto,
    ...(bloque.cachear ? { cache_control: { type: 'ephemeral' } } : {}),
  }));

  const messages: Anthropic.MessageParam[] = peticion.mensajes.map((m) => ({
    role: m.rol === 'usuario' ? 'user' : 'assistant',
    content: m.texto,
  }));

  const outputConfig: Anthropic.OutputConfig = {
    ...(peticion.esquema === undefined ? {} : { format: formatoJson(peticion.esquema) }),
    // Opus 5.5 no deja apagar el razonamiento: el esfuerzo bajo es la única
    // forma de que una tarea sencilla no se cobre como una difícil.
    ...(modelo.pensamiento === 'solo-esfuerzo' ? { effort: 'low' as const } : {}),
  };

  return {
    model: modelo.id,
    max_tokens: peticion.maxTokens,
    system,
    messages,
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    ...(modelo.pensamiento === 'desactivable' ? { thinking: { type: 'disabled' } } : {}),
  };
}

function formatoJson(esquema: z.ZodType): Anthropic.JSONOutputFormat {
  // `zodOutputFormat` adapta el esquema a lo que admiten las salidas
  // estructuradas (quita las restricciones que la API no entiende). La
  // validación completa la hace el router con el esquema original.
  const { schema } = zodOutputFormat(esquema);
  return { type: 'json_schema', schema };
}

function motivo(stop: Anthropic.StopReason | null): MotivoDeParada {
  switch (stop) {
    case 'end_turn':
    case 'stop_sequence':
      return 'fin';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'rechazo';
    default:
      return 'otro';
  }
}

function aUso(usage: Anthropic.Usage): Uso {
  return {
    entrada: usage.input_tokens,
    salida: usage.output_tokens,
    cacheEscrita: usage.cache_creation_input_tokens ?? 0,
    cacheLeida: usage.cache_read_input_tokens ?? 0,
  };
}

export function deMensajeDeAnthropic(mensaje: Anthropic.Message): RespuestaDelModelo {
  const texto = mensaje.content
    .flatMap((bloque) => (bloque.type === 'text' ? [bloque.text] : []))
    .join('');
  return {
    texto,
    uso: aUso(mensaje.usage),
    motivoDeParada: motivo(mensaje.stop_reason),
    idDelProveedor: mensaje.id,
  };
}

function estadoDeLote(lote: Anthropic.Messages.MessageBatch): ResumenDeLote {
  const c = lote.request_counts;
  const estado: EstadoDeLote =
    lote.processing_status === 'ended'
      ? 'terminado'
      : lote.processing_status === 'canceling'
        ? 'cancelado'
        : 'en-proceso';
  return {
    idDelProveedor: lote.id,
    estado,
    pendientes: c.processing,
    correctas: c.succeeded,
    fallidas: c.errored + c.canceled + c.expired,
  };
}

/** `custom_id` admite letras, números, `_` y `-`, hasta 64 caracteres. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

class LotesDeAnthropic implements ProveedorDeLotes {
  private readonly cliente: Anthropic;

  constructor(cliente: Anthropic) {
    this.cliente = cliente;
  }

  async crear(peticiones: readonly PeticionDeLote[]): Promise<ResumenDeLote> {
    for (const p of peticiones) {
      if (!ID_VALIDO.test(p.id)) {
        throw new Error(
          `El identificador de petición «${p.id}» no es válido para un lote: solo letras, números, «_» y «-», hasta 64.`,
        );
      }
    }
    const lote = await this.cliente.messages.batches.create({
      requests: peticiones.map((p) => ({
        custom_id: p.id,
        params: aParametrosDeAnthropic(p.peticion),
      })),
    });
    return estadoDeLote(lote);
  }

  async consultar(idDelProveedor: string): Promise<ResumenDeLote> {
    return estadoDeLote(await this.cliente.messages.batches.retrieve(idDelProveedor));
  }

  async resultados(idDelProveedor: string): Promise<readonly ResultadoDePeticionDeLote[]> {
    const salida: ResultadoDePeticionDeLote[] = [];
    for await (const r of await this.cliente.messages.batches.results(idDelProveedor)) {
      switch (r.result.type) {
        case 'succeeded':
          salida.push({
            id: r.custom_id,
            tipo: 'ok',
            respuesta: deMensajeDeAnthropic(r.result.message),
          });
          break;
        case 'errored':
          salida.push({ id: r.custom_id, tipo: 'error', mensaje: r.result.error.error.message });
          break;
        case 'canceled':
          salida.push({ id: r.custom_id, tipo: 'error', mensaje: 'Petición cancelada.' });
          break;
        case 'expired':
          salida.push({
            id: r.custom_id,
            tipo: 'error',
            mensaje: 'El lote caducó antes de procesarla.',
          });
          break;
      }
    }
    return salida;
  }
}

export class ProveedorAnthropic implements ModelProvider {
  readonly id = 'anthropic';
  readonly lotes: ProveedorDeLotes;
  private readonly cliente: Anthropic;

  constructor(config: ConfigAnthropic | { readonly cliente: Anthropic }) {
    this.cliente =
      'cliente' in config
        ? config.cliente
        : new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs ?? 60_000 });
    this.lotes = new LotesDeAnthropic(this.cliente);
  }

  async generar(peticion: PeticionAlModelo): Promise<RespuestaDelModelo> {
    return deMensajeDeAnthropic(
      await this.cliente.messages.create(aParametrosDeAnthropic(peticion)),
    );
  }
}
