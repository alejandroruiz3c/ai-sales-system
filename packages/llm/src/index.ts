/**
 * @sales-os/llm
 *
 * La única puerta del sistema a un modelo (CLAUDE.md §1: «Ninguna llamada
 * directa al SDK de Anthropic fuera de ese paquete»). Router por nivel de
 * tarea, caché del bloque fijo, modo lote, salidas validadas con Zod y un
 * único reintento, reserva y liquidación en el presupuesto del tenant, y traza
 * en Langfuse.
 */

export {
  elegirModelo,
  modeloPorId,
  MODELOS,
  NIVELES,
  SinModeloCapaz,
  type ControlDePensamiento,
  type Modelo,
  type Nivel,
  type Precio,
} from './modelos.ts';

export {
  costeEnEuros,
  costeMaximoEnEuros,
  estimarTokens,
  FACTOR_LOTE,
  sumarUso,
  USO_VACIO,
  type OpcionesDeCoste,
  type Uso,
} from './coste.ts';

export type {
  BloqueDeSistema,
  EstadoDeLote,
  MensajeAlModelo,
  ModelProvider,
  MotivoDeParada,
  PeticionAlModelo,
  PeticionDeLote,
  ProveedorDeLotes,
  RespuestaDelModelo,
  ResultadoDePeticionDeLote,
  ResumenDeLote,
} from './proveedor.ts';

export {
  extraerJson,
  mensajeDeCorreccion,
  validarSalida,
  type ResultadoDeValidacion,
} from './salida.ts';

export {
  PresupuestoEnMemoria,
  type Autorizacion,
  type Liquidacion,
  type MotivoDeRechazo,
  type PeticionDeAutorizacion,
  type Presupuesto,
} from './presupuesto.ts';

export {
  eventosDeLangfuse,
  TRAZADOR_NULO,
  TrazadorEnMemoria,
  TrazadorLangfuse,
  type ConfigLangfuse,
  type IntentoTrazado,
  type ResultadoTrazado,
  type TrazaDeLlamada,
  type Trazador,
} from './trazas.ts';

export {
  crearRouter,
  type ConfigRouter,
  type ElementoDeLote,
  type LoteCreado,
  type OrigenDePlantilla,
  type PeticionDeGeneracion,
  type PeticionDeLoteDelRouter,
  type RecogidaDeLote,
  type ResultadoDeElemento,
  type ResultadoDeGeneracion,
  type Router,
} from './router.ts';

export {
  ProveedorAnthropic,
  aParametrosDeAnthropic,
  type ConfigAnthropic,
} from './proveedores/anthropic.ts';
export {
  ProveedorConFallos,
  ProveedorSimulado,
  type ConfigSimulado,
  type Respondedor,
} from './proveedores/simulado.ts';

export interface PackageManifest {
  /** Nombre del paquete en el workspace. */
  readonly name: string;
  /** Qué resuelve este paquete. */
  readonly description: string;
  /** Fase del plan en la que se implementa. */
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/llm',
  description: 'Router de modelos, caché de prompts, modo lote y contabilidad de coste',
  phase: 'F2',
};
