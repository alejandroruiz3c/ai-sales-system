/**
 * Proveedor simulado (F2.8): se intercambia con el real sin tocar el router.
 *
 * Sirve para tres cosas:
 *
 *   · **los tests**, que prueban el router, la validación, el presupuesto y la
 *     contabilidad sin red y sin gastar;
 *   · **demostrar la interfaz**: si el router funciona igual con este proveedor
 *     que con el de Anthropic, la interfaz es de verdad neutra y enchufar otro
 *     proveedor o un modelo propio es escribir una clase como esta;
 *   · **el kit**, que puede pedirle respuestas malformadas a propósito.
 *
 * Imita lo que al router le importa del proveedor real, y nada más: la caché
 * (el mismo prefijo, por encima del mínimo del modelo, se lee en vez de
 * escribirse) y el modo lote (un lote tarda unas cuantas consultas en
 * terminar). Los tokens se estiman igual que en `coste.ts`.
 */

import { estimarTokens, type Uso } from '../coste.ts';
import type {
  ModelProvider,
  PeticionAlModelo,
  PeticionDeLote,
  ProveedorDeLotes,
  RespuestaDelModelo,
  ResultadoDePeticionDeLote,
  ResumenDeLote,
} from '../proveedor.ts';

/** Cómo responde el simulado: una función de la petición y del número de llamada. */
export type Respondedor = (peticion: PeticionAlModelo, numeroDeLlamada: number) => string;

export interface ConfigSimulado {
  readonly responder: Respondedor;
  /** Cuántas consultas tarda un lote en terminar. Por defecto, dos. */
  readonly consultasHastaTerminarLote?: number;
}

function prefijoCacheable(peticion: PeticionAlModelo): string | undefined {
  const ultimo = peticion.sistema.findLastIndex((b) => b.cachear);
  if (ultimo === -1) return undefined;
  return peticion.sistema
    .slice(0, ultimo + 1)
    .map((b) => b.texto)
    .join('\n');
}

export class ProveedorSimulado implements ModelProvider {
  readonly id = 'simulado';
  readonly lotes: ProveedorDeLotes;
  /** Todas las peticiones recibidas, en orden. Los tests las inspeccionan. */
  readonly recibidas: PeticionAlModelo[] = [];
  private readonly cache = new Set<string>();

  private readonly config: ConfigSimulado;

  constructor(config: ConfigSimulado) {
    this.config = config;
    this.lotes = new LotesSimulados(this, config.consultasHastaTerminarLote ?? 2);
  }

  generar(peticion: PeticionAlModelo): Promise<RespuestaDelModelo> {
    return Promise.resolve(this.responderSincrono(peticion));
  }

  /** @internal lo usa también el modo lote. */
  responderSincrono(peticion: PeticionAlModelo): RespuestaDelModelo {
    this.recibidas.push(peticion);
    const texto = this.config.responder(peticion, this.recibidas.length);
    return { texto, uso: this.uso(peticion, texto), motivoDeParada: 'fin' };
  }

  private uso(peticion: PeticionAlModelo, salida: string): Uso {
    const todoElSistema = peticion.sistema.map((b) => b.texto).join('\n');
    const mensajes = peticion.mensajes.map((m) => m.texto).join('\n');
    const prefijo = prefijoCacheable(peticion);
    const tokensPrefijo = prefijo === undefined ? 0 : estimarTokens(prefijo);
    const tokensTotales = estimarTokens(todoElSistema) + estimarTokens(mensajes);

    let cacheEscrita = 0;
    let cacheLeida = 0;
    if (prefijo !== undefined && tokensPrefijo >= peticion.modelo.minimoCacheable) {
      // La caché es por modelo, igual que en el proveedor real.
      const clave = `${peticion.modelo.id}\u0000${prefijo}`;
      if (this.cache.has(clave)) cacheLeida = tokensPrefijo;
      else {
        this.cache.add(clave);
        cacheEscrita = tokensPrefijo;
      }
    }

    return {
      entrada: Math.max(0, tokensTotales - cacheEscrita - cacheLeida),
      salida: estimarTokens(salida),
      cacheEscrita,
      cacheLeida,
    };
  }
}

interface LoteGuardado {
  readonly peticiones: readonly PeticionDeLote[];
  consultas: number;
  resultados?: readonly ResultadoDePeticionDeLote[];
}

class LotesSimulados implements ProveedorDeLotes {
  private readonly guardados = new Map<string, LoteGuardado>();
  private siguiente = 1;

  private readonly proveedor: ProveedorSimulado;
  private readonly consultasHastaTerminar: number;

  constructor(proveedor: ProveedorSimulado, consultasHastaTerminar: number) {
    this.proveedor = proveedor;
    this.consultasHastaTerminar = consultasHastaTerminar;
  }

  crear(peticiones: readonly PeticionDeLote[]): Promise<ResumenDeLote> {
    const id = `lote_simulado_${String(this.siguiente++)}`;
    this.guardados.set(id, { peticiones, consultas: 0 });
    return Promise.resolve({
      idDelProveedor: id,
      estado: 'en-proceso',
      pendientes: peticiones.length,
      correctas: 0,
      fallidas: 0,
    });
  }

  consultar(idDelProveedor: string): Promise<ResumenDeLote> {
    const lote = this.buscar(idDelProveedor);
    lote.consultas += 1;
    const terminado = lote.consultas >= this.consultasHastaTerminar;
    if (terminado && lote.resultados === undefined) {
      lote.resultados = lote.peticiones.map((p) => ({
        id: p.id,
        tipo: 'ok' as const,
        respuesta: this.proveedor.responderSincrono(p.peticion),
      }));
    }
    const total = lote.peticiones.length;
    return Promise.resolve({
      idDelProveedor,
      estado: terminado ? 'terminado' : 'en-proceso',
      pendientes: terminado ? 0 : total,
      correctas: terminado ? total : 0,
      fallidas: 0,
    });
  }

  resultados(idDelProveedor: string): Promise<readonly ResultadoDePeticionDeLote[]> {
    const lote = this.buscar(idDelProveedor);
    if (lote.resultados === undefined) {
      return Promise.reject(new Error(`El lote ${idDelProveedor} todavía no ha terminado.`));
    }
    return Promise.resolve(lote.resultados);
  }

  private buscar(id: string): LoteGuardado {
    const lote = this.guardados.get(id);
    if (lote === undefined) throw new Error(`No existe el lote ${id}.`);
    return lote;
  }
}

/**
 * Envuelve un proveedor y estropea sus primeras respuestas (caso T2.5).
 *
 * Existe para poder comprobar en `/lab`, contra el modelo de verdad, que una
 * salida malformada se reintenta una vez y, si vuelve a fallar, se marca sin
 * romper nada. El modelo real con salidas estructuradas casi nunca se
 * equivoca de forma, así que esperar a que falle solo no es una prueba.
 *
 * El coste de la llamada estropeada **se cobra igual**: el modelo ha trabajado
 * y el proveedor lo factura. Lo único que cambia es el texto que recibe el
 * router.
 */
export class ProveedorConFallos implements ModelProvider {
  readonly id: string;
  private llamadas = 0;

  private readonly real: ModelProvider;
  private readonly fallosAntesDeResponderBien: number;

  constructor(real: ModelProvider, fallosAntesDeResponderBien: number) {
    this.real = real;
    this.fallosAntesDeResponderBien = fallosAntesDeResponderBien;
    this.id = `${real.id}+fallos`;
  }

  async generar(peticion: PeticionAlModelo): Promise<RespuestaDelModelo> {
    const respuesta = await this.real.generar(peticion);
    this.llamadas += 1;
    if (this.llamadas > this.fallosAntesDeResponderBien) return respuesta;
    return {
      ...respuesta,
      texto: `${respuesta.texto.slice(0, 20)} … [respuesta cortada a propósito]`,
    };
  }
}
