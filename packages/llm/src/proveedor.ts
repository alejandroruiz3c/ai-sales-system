/**
 * La interfaz que tiene que cumplir cualquier proveedor de modelos (F2.8).
 *
 * El router no sabe qué hay detrás: hoy es Anthropic, en los tests es un
 * proveedor simulado, y el día que haga falta será otro proveedor o un modelo
 * propio. Lo que cambia entre ellos queda dentro de su implementación; lo que
 * el router necesita saber está aquí:
 *
 *   · qué bloques del prompt son fijos y se pueden cachear;
 *   · qué forma tiene que tener la salida, si la tiene;
 *   · cuánto se ha consumido, separado como se factura.
 *
 * Un proveedor **no** cobra, **no** traza y **no** valida: eso lo hace el
 * router, una sola vez y para todos. Si un proveedor lo hiciera, cambiar de
 * proveedor cambiaría la contabilidad.
 */

import type { z } from 'zod';

import type { Uso } from './coste.ts';
import type { Modelo } from './modelos.ts';

/** Un bloque del prompt de sistema. */
export interface BloqueDeSistema {
  readonly texto: string;
  /**
   * Si el proveedor debe cachear el prompt **hasta este bloque incluido**. El
   * router lo marca en el último bloque fijo: el perfil comercial y las
   * instrucciones del agente, que se repiten en miles de llamadas por tenant.
   */
  readonly cachear: boolean;
}

export interface MensajeAlModelo {
  readonly rol: 'usuario' | 'asistente';
  readonly texto: string;
}

export interface PeticionAlModelo {
  readonly modelo: Modelo;
  readonly sistema: readonly BloqueDeSistema[];
  readonly mensajes: readonly MensajeAlModelo[];
  readonly maxTokens: number;
  /**
   * Esquema de la salida. Si el proveedor sabe forzar la forma (salidas
   * estructuradas), lo usa; si no, la instrucción del prompt basta. En los dos
   * casos el router valida después: el esquema del proveedor es una ayuda, no
   * la frontera.
   */
  readonly esquema?: z.ZodType;
}

export type MotivoDeParada = 'fin' | 'max_tokens' | 'rechazo' | 'otro';

export interface RespuestaDelModelo {
  readonly texto: string;
  readonly uso: Uso;
  readonly motivoDeParada: MotivoDeParada;
  /** Identificador de la respuesta en el proveedor, para cruzarlo con su consola. */
  readonly idDelProveedor?: string;
}

// ── Modo lote (F2.3) ─────────────────────────────────────────────────────────

export interface PeticionDeLote {
  /** Identificador propio de cada petición. Los resultados vuelven en cualquier orden. */
  readonly id: string;
  readonly peticion: PeticionAlModelo;
}

export type EstadoDeLote = 'en-proceso' | 'terminado' | 'cancelado';

export interface ResumenDeLote {
  readonly idDelProveedor: string;
  readonly estado: EstadoDeLote;
  readonly pendientes: number;
  readonly correctas: number;
  readonly fallidas: number;
}

export type ResultadoDePeticionDeLote =
  | { readonly id: string; readonly tipo: 'ok'; readonly respuesta: RespuestaDelModelo }
  | { readonly id: string; readonly tipo: 'error'; readonly mensaje: string };

export interface ProveedorDeLotes {
  crear(peticiones: readonly PeticionDeLote[]): Promise<ResumenDeLote>;
  consultar(idDelProveedor: string): Promise<ResumenDeLote>;
  resultados(idDelProveedor: string): Promise<readonly ResultadoDePeticionDeLote[]>;
}

// ── El contrato ──────────────────────────────────────────────────────────────

export interface ModelProvider {
  /** Nombre del proveedor, para las trazas. */
  readonly id: string;
  generar(peticion: PeticionAlModelo): Promise<RespuestaDelModelo>;
  /** Solo si el proveedor tiene modo lote. Sin él, el router lo dice y no lo simula. */
  readonly lotes?: ProveedorDeLotes;
}
