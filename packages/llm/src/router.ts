/**
 * El router de modelos (F2.1–F2.5): la única puerta del sistema a un modelo.
 *
 * Todo agente que necesite un modelo pasa por aquí, y aquí se hace una sola
 * vez, igual para todos, lo que ningún agente debería poder saltarse:
 *
 *   1. **elegir el modelo más barato capaz** del nivel de la tarea (F2.1);
 *   2. **reservar en el presupuesto** el coste máximo antes de llamar. Si no
 *      cabe, la llamada no se hace (F1.13: «un tenant sin presupuesto no
 *      ejecuta llamadas LLM»);
 *   3. **cachear el bloque fijo** del prompt: instrucciones del agente y
 *      perfil comercial, que se repiten en miles de llamadas por tenant (F2.2);
 *   4. **validar la salida con Zod** y reintentar **una sola vez** con los
 *      errores concretos. Si vuelve a fallar, se devuelve marcada, sin lanzar
 *      (F2.4);
 *   5. **liquidar el coste real** en el libro de gasto y **trazar** en
 *      Langfuse, separado por tenant y por agente (F2.5).
 *
 * El router no lanza por nada que pueda pasar en producción (presupuesto,
 * salida inválida, proveedor caído): devuelve un resultado con su estado y su
 * motivo, que es lo que el panel enseña y lo que el Copiloto diagnostica. Solo
 * lanza por errores de programación (una petición sin tenant).
 */

import { randomUUID } from 'node:crypto';

import type { z } from 'zod';

import {
  costeEnEuros,
  costeMaximoEnEuros,
  estimarTokens,
  sumarUso,
  USO_VACIO,
  type Uso,
} from './coste.ts';
import { elegirModelo, MODELOS, type Modelo, type Nivel } from './modelos.ts';
import type {
  BloqueDeSistema,
  MensajeAlModelo,
  ModelProvider,
  PeticionAlModelo,
  ResumenDeLote,
} from './proveedor.ts';
import type { MotivoDeRechazo, Presupuesto } from './presupuesto.ts';
import { mensajeDeCorreccion, validarSalida } from './salida.ts';
import {
  TRAZADOR_NULO,
  type IntentoTrazado,
  type ResultadoTrazado,
  type Trazador,
} from './trazas.ts';

export interface ConfigRouter {
  readonly proveedor: ModelProvider;
  readonly presupuesto: Presupuesto;
  readonly trazador?: Trazador;
  /** Euros por dólar. Los precios del catálogo están en dólares; el libro, en euros. */
  readonly tipoCambioUsdEur: number;
  readonly modelos?: readonly Modelo[];
  readonly reloj?: () => Date;
  readonly generarId?: () => string;
  /** Para lo que no rompe la llamada pero alguien tiene que saber (una traza perdida). */
  readonly alAvisar?: (mensaje: string, datos: Record<string, string | number | boolean>) => void;
}

/** Plantilla de la que sale el prompt, para poder cruzar trazas con versiones. */
export interface OrigenDePlantilla {
  readonly id: string;
  readonly version: string;
}

export interface PeticionDeGeneracion<T> {
  readonly tenantId: string;
  readonly agente: string;
  /** Qué se le pide al modelo, en una palabra: `clasificar-respuesta`, `redactar-email`… */
  readonly tarea: string;
  readonly nivel: Nivel;
  /**
   * Bloques fijos del prompt de sistema: instrucciones del agente y perfil
   * comercial. Se cachean hasta el último. **No pueden llevar nada que cambie
   * en cada llamada** (la fecha, el prospecto): un solo carácter distinto
   * invalida la caché entera.
   */
  readonly bloquesFijos: readonly string[];
  /** La parte que cambia en cada llamada: el prospecto, el mensaje a clasificar. */
  readonly mensaje: string;
  readonly esquema?: z.ZodType<T>;
  /**
   * Si el proveedor debe forzar la forma de la salida (salidas estructuradas).
   * Por defecto, sí. Cuesta tokens de entrada: el esquema se añade al prompt
   * (unos 450 con Haiku 4.5, más que el propio prompt de una clasificación).
   * En tareas masivas y baratas puede salir más a cuenta desactivarlo y dejar
   * la forma a la validación Zod y a su único reintento, que se hacen igual.
   */
  readonly formatoEstricto?: boolean;
  readonly maxTokens: number;
  readonly plantilla?: OrigenDePlantilla;
  readonly referencia?: string;
}

interface DatosComunes {
  readonly trazaId: string;
  readonly modelo: string;
  readonly nivel: Nivel;
  readonly costeEur: number;
  readonly uso: Uso;
  readonly cacheAcertada: boolean;
  readonly intentos: number;
  /** Por qué no se ha cacheado, cuando no se ha cacheado. */
  readonly avisoDeCache?: string;
}

export type ResultadoDeGeneracion<T> =
  | (DatosComunes & { readonly estado: 'valida'; readonly datos: T; readonly texto: string })
  | (DatosComunes & { readonly estado: 'texto'; readonly texto: string })
  | (DatosComunes & {
      readonly estado: 'fallida';
      readonly texto: string;
      readonly errores: readonly string[];
    })
  | (DatosComunes & { readonly estado: 'error'; readonly mensaje: string })
  | (DatosComunes & {
      readonly estado: 'bloqueada';
      readonly motivo: MotivoDeRechazo;
      readonly mensaje: string;
    });

// ── Lotes ────────────────────────────────────────────────────────────────────

export interface ElementoDeLote {
  /** Letras, números, `_` y `-`, hasta 64: es el `custom_id` del proveedor. */
  readonly id: string;
  readonly mensaje: string;
}

export interface PeticionDeLoteDelRouter<T> extends Omit<PeticionDeGeneracion<T>, 'mensaje'> {
  readonly elementos: readonly ElementoDeLote[];
}

export type LoteCreado =
  | {
      readonly estado: 'creado';
      readonly loteId: string;
      readonly reservaId: string;
      readonly modelo: string;
      readonly nivel: Nivel;
      readonly elementos: number;
      readonly costeMaximoEur: number;
    }
  | {
      readonly estado: 'bloqueada';
      readonly motivo: MotivoDeRechazo;
      readonly mensaje: string;
      readonly modelo: string;
      readonly nivel: Nivel;
    };

export type ResultadoDeElemento<T> =
  | {
      readonly id: string;
      readonly estado: 'valida';
      readonly datos: T;
      readonly reintentado: boolean;
    }
  | { readonly id: string; readonly estado: 'texto'; readonly texto: string }
  | {
      readonly id: string;
      readonly estado: 'fallida';
      readonly errores: readonly string[];
      readonly reintentado: boolean;
    };

export type RecogidaDeLote<T> =
  | { readonly estado: 'en-proceso'; readonly resumen: ResumenDeLote }
  | {
      readonly estado: 'terminado';
      readonly trazaId: string;
      readonly modelo: string;
      readonly resultados: readonly ResultadoDeElemento<T>[];
      /** Lo que ha costado el lote más los reintentos individuales. */
      readonly costeEur: number;
      readonly costeDelLoteEur: number;
      readonly costeDeReintentosEur: number;
      /** Lo que habría costado el mismo uso fuera de lote: para ver el ahorro (T2.4). */
      readonly costeSinLoteEur: number;
      readonly costePorElementoEur: number;
      readonly uso: Uso;
      readonly cacheAcertada: boolean;
    };

export interface Router {
  generar<T = never>(peticion: PeticionDeGeneracion<T>): Promise<ResultadoDeGeneracion<T>>;
  crearLote<T = never>(peticion: PeticionDeLoteDelRouter<T>): Promise<LoteCreado>;
  recogerLote<T = never>(
    peticion: PeticionDeLoteDelRouter<T> & { readonly loteId: string; readonly reservaId: string },
  ): Promise<RecogidaDeLote<T>>;
  /** El modelo que se usaría para un nivel, sin llamar. Para `/lab` y el Estudio. */
  modeloPara(nivel: Nivel): Modelo;
}

/** Reserva de una llamada directa: si el proceso muere, se libera sola a los 15 minutos. */
const VALIDEZ_DIRECTA_S = 15 * 60;
/** Un lote puede tardar hasta 24 horas; la reserva dura un poco más. */
const VALIDEZ_LOTE_S = 25 * 60 * 60;

function sistemaCacheado(bloquesFijos: readonly string[]): BloqueDeSistema[] {
  return bloquesFijos.map((texto, i) => ({ texto, cachear: i === bloquesFijos.length - 1 }));
}

export function crearRouter(config: ConfigRouter): Router {
  const modelos = config.modelos ?? MODELOS;
  const reloj = config.reloj ?? (() => new Date());
  const generarId = config.generarId ?? randomUUID;
  const trazador = config.trazador ?? TRAZADOR_NULO;
  const opcionesDeCoste = { tipoCambioUsdEur: config.tipoCambioUsdEur };

  function comprobar(peticion: {
    readonly tenantId: string;
    readonly agente: string;
    readonly bloquesFijos: readonly string[];
    readonly maxTokens: number;
  }): void {
    // «Nada sin tenant_id» (CLAUDE.md §1). Una llamada sin tenant no tiene a
    // quién cobrarse, y eso es un error de programación, no de ejecución.
    if (peticion.tenantId.trim() === '') throw new Error('Toda llamada a modelo lleva tenant.');
    if (peticion.agente.trim() === '') throw new Error('Toda llamada a modelo lleva agente.');
    if (peticion.bloquesFijos.length === 0) throw new Error('Falta el bloque fijo del prompt.');
    if (!Number.isInteger(peticion.maxTokens) || peticion.maxTokens <= 0) {
      throw new Error('maxTokens tiene que ser un entero positivo.');
    }
  }

  function avisoDeCache(modelo: Modelo, bloquesFijos: readonly string[]): string | undefined {
    const tokens = estimarTokens(bloquesFijos.join('\n'));
    if (tokens >= modelo.minimoCacheable) return undefined;
    return `El bloque fijo (unos ${String(tokens)} tokens) no llega al mínimo de caché de ${modelo.nombre} (${String(modelo.minimoCacheable)}): esta tarea no se cachea.`;
  }

  async function avisarSiFalla(
    promesa: Promise<void>,
    que: string,
    trazaId: string,
  ): Promise<void> {
    try {
      await promesa;
    } catch (error) {
      config.alAvisar?.(`No se ha podido ${que}`, {
        trazaId,
        error: error instanceof Error ? error.message : 'desconocido',
      });
    }
  }

  /**
   * Una llamada al proveedor con su reserva y su liquidación.
   *
   * La liquidación va en `finally`: se liquida también si el proveedor falla,
   * con coste cero, porque una reserva sin liberar bloquea presupuesto.
   */
  async function llamarUnaVez(
    peticion: PeticionDeGeneracion<unknown>,
    modelo: Modelo,
    mensajes: readonly MensajeAlModelo[],
    numero: number,
  ): Promise<
    | { readonly tipo: 'ok'; readonly intento: IntentoTrazado }
    | { readonly tipo: 'bloqueada'; readonly motivo: MotivoDeRechazo; readonly mensaje: string }
    | { readonly tipo: 'error'; readonly mensaje: string; readonly intento: IntentoTrazado }
  > {
    const alModelo: PeticionAlModelo = {
      modelo,
      sistema: sistemaCacheado(peticion.bloquesFijos),
      mensajes,
      maxTokens: peticion.maxTokens,
      ...(peticion.esquema === undefined || peticion.formatoEstricto === false
        ? {}
        : { esquema: peticion.esquema }),
    };
    const tokensDeEntrada = estimarTokens(
      [...peticion.bloquesFijos, ...mensajes.map((m) => m.texto)].join('\n'),
    );
    const referencia = peticion.referencia ?? `${peticion.tarea}#${String(numero)}`;

    const autorizacion = await config.presupuesto.autorizar({
      tenantId: peticion.tenantId,
      agente: peticion.agente,
      importeMaximoEur: costeMaximoEnEuros(
        modelo,
        tokensDeEntrada,
        peticion.maxTokens,
        opcionesDeCoste,
      ),
      referencia,
      validezSegundos: VALIDEZ_DIRECTA_S,
    });
    if (!autorizacion.permitida) {
      return { tipo: 'bloqueada', motivo: autorizacion.motivo, mensaje: autorizacion.mensaje };
    }

    const inicio = reloj();
    let uso: Uso = USO_VACIO;
    let costeEur = 0;
    try {
      const respuesta = await config.proveedor.generar(alModelo);
      uso = respuesta.uso;
      costeEur = costeEnEuros(modelo, uso, opcionesDeCoste);
      const intento: IntentoTrazado = {
        numero,
        modelo: modelo.id,
        uso,
        costeEur,
        texto: respuesta.texto,
        inicio,
        fin: reloj(),
        ...(respuesta.idDelProveedor === undefined
          ? {}
          : { idDelProveedor: respuesta.idDelProveedor }),
      };
      if (respuesta.motivoDeParada === 'rechazo') {
        return { tipo: 'error', mensaje: 'El modelo ha rechazado la petición.', intento };
      }
      return { tipo: 'ok', intento };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido del proveedor';
      return {
        tipo: 'error',
        mensaje: `El proveedor de modelos ha fallado: ${mensaje}`,
        intento: { numero, modelo: modelo.id, uso, costeEur, texto: '', inicio, fin: reloj() },
      };
    } finally {
      await config.presupuesto.liquidar({
        reservaId: autorizacion.reservaId,
        tenantId: peticion.tenantId,
        agente: peticion.agente,
        modelo: modelo.id,
        uso,
        costeEur,
        cacheAcertada: uso.cacheLeida > 0,
        modo: 'directo',
        referencia,
      });
    }
  }

  async function generar<T>(peticion: PeticionDeGeneracion<T>): Promise<ResultadoDeGeneracion<T>> {
    comprobar(peticion);
    const modelo = elegirModelo(peticion.nivel, modelos);
    const trazaId = generarId();
    const inicio = reloj();
    const aviso = avisoDeCache(modelo, peticion.bloquesFijos);
    const intentos: IntentoTrazado[] = [];

    const base = (): DatosComunes => {
      const uso = intentos.reduce<Uso>((total, i) => sumarUso(total, i.uso), USO_VACIO);
      return {
        trazaId,
        modelo: modelo.id,
        nivel: peticion.nivel,
        costeEur: Math.round(intentos.reduce((t, i) => t + i.costeEur, 0) * 1e6) / 1e6,
        uso,
        cacheAcertada: uso.cacheLeida > 0,
        intentos: intentos.length,
        ...(aviso === undefined ? {} : { avisoDeCache: aviso }),
      };
    };

    const cerrar = async (
      resultado: ResultadoDeGeneracion<T>,
      trazado: ResultadoTrazado,
      salida: string,
      motivo?: string,
    ): Promise<ResultadoDeGeneracion<T>> => {
      await avisarSiFalla(
        trazador.registrar({
          id: trazaId,
          tenantId: peticion.tenantId,
          agente: peticion.agente,
          tarea: peticion.tarea,
          ...(peticion.plantilla === undefined ? {} : { plantilla: peticion.plantilla }),
          nivel: peticion.nivel,
          modelo: modelo.id,
          proveedor: config.proveedor.id,
          modo: 'directo',
          resultado: trazado,
          intentos,
          costeEur: resultado.costeEur,
          uso: resultado.uso,
          cacheAcertada: resultado.cacheAcertada,
          entrada: { sistema: peticion.bloquesFijos.join('\n\n'), mensaje: peticion.mensaje },
          salida,
          ...(motivo === undefined ? {} : { motivo }),
          inicio,
          fin: reloj(),
        }),
        'registrar la traza en Langfuse',
        trazaId,
      );
      return resultado;
    };

    const mensajes: MensajeAlModelo[] = [{ rol: 'usuario', texto: peticion.mensaje }];

    for (let numero = 1; numero <= 2; numero++) {
      const llamada = await llamarUnaVez(peticion, modelo, mensajes, numero);

      if (llamada.tipo === 'bloqueada') {
        return cerrar(
          { ...base(), estado: 'bloqueada', motivo: llamada.motivo, mensaje: llamada.mensaje },
          'bloqueada',
          '',
          llamada.mensaje,
        );
      }
      intentos.push(llamada.intento);
      if (llamada.tipo === 'error') {
        return cerrar(
          { ...base(), estado: 'error', mensaje: llamada.mensaje },
          'error',
          '',
          llamada.mensaje,
        );
      }

      const texto = llamada.intento.texto;
      if (peticion.esquema === undefined) {
        return cerrar({ ...base(), estado: 'texto', texto }, 'texto', texto);
      }

      const validacion = validarSalida(texto, peticion.esquema);
      if (validacion.valida) {
        return cerrar(
          { ...base(), estado: 'valida', datos: validacion.datos, texto },
          'valida',
          texto,
        );
      }

      // Se anota qué falló en el propio intento, para que la traza lo enseñe.
      intentos[intentos.length - 1] = { ...llamada.intento, errores: validacion.errores };

      if (numero === 2) {
        return cerrar(
          { ...base(), estado: 'fallida', texto, errores: validacion.errores },
          'fallida',
          texto,
          'La salida no cumple el esquema tras el reintento.',
        );
      }
      mensajes.push(
        { rol: 'asistente', texto },
        { rol: 'usuario', texto: mensajeDeCorreccion(validacion.errores) },
      );
    }

    // El bucle devuelve siempre en su segunda vuelta.
    throw new Error('Inalcanzable: el router ha salido del bucle de reintento.');
  }

  async function crearLote<T>(peticion: PeticionDeLoteDelRouter<T>): Promise<LoteCreado> {
    comprobar(peticion);
    const modelo = elegirModelo(peticion.nivel, modelos);
    const lotes = config.proveedor.lotes;
    if (lotes === undefined) {
      throw new Error(`El proveedor ${config.proveedor.id} no tiene modo lote.`);
    }
    if (peticion.elementos.length === 0) throw new Error('Un lote necesita al menos un elemento.');

    const sistema = sistemaCacheado(peticion.bloquesFijos);
    const tokensFijos = estimarTokens(peticion.bloquesFijos.join('\n'));
    const costeMaximoEur = peticion.elementos.reduce(
      (total, e) =>
        total +
        costeMaximoEnEuros(modelo, tokensFijos + estimarTokens(e.mensaje), peticion.maxTokens, {
          ...opcionesDeCoste,
          lote: true,
        }),
      0,
    );

    const autorizacion = await config.presupuesto.autorizar({
      tenantId: peticion.tenantId,
      agente: peticion.agente,
      importeMaximoEur: Math.round(costeMaximoEur * 1e6) / 1e6,
      referencia: peticion.referencia ?? `${peticion.tarea}#lote`,
      validezSegundos: VALIDEZ_LOTE_S,
    });
    if (!autorizacion.permitida) {
      return {
        estado: 'bloqueada',
        motivo: autorizacion.motivo,
        mensaje: autorizacion.mensaje,
        modelo: modelo.id,
        nivel: peticion.nivel,
      };
    }

    try {
      const resumen = await lotes.crear(
        peticion.elementos.map((e) => ({
          id: e.id,
          peticion: {
            modelo,
            sistema,
            mensajes: [{ rol: 'usuario', texto: e.mensaje }],
            maxTokens: peticion.maxTokens,
            ...(peticion.esquema === undefined || peticion.formatoEstricto === false
              ? {}
              : { esquema: peticion.esquema }),
          },
        })),
      );
      return {
        estado: 'creado',
        loteId: resumen.idDelProveedor,
        reservaId: autorizacion.reservaId,
        modelo: modelo.id,
        nivel: peticion.nivel,
        elementos: peticion.elementos.length,
        costeMaximoEur: Math.round(costeMaximoEur * 1e6) / 1e6,
      };
    } catch (error) {
      // El lote no ha llegado a existir: se libera la reserva sin coste.
      await config.presupuesto.liquidar({
        reservaId: autorizacion.reservaId,
        tenantId: peticion.tenantId,
        agente: peticion.agente,
        modelo: modelo.id,
        uso: USO_VACIO,
        costeEur: 0,
        cacheAcertada: false,
        modo: 'lote',
        referencia: peticion.referencia ?? `${peticion.tarea}#lote`,
      });
      throw error;
    }
  }

  async function recogerLote<T>(
    peticion: PeticionDeLoteDelRouter<T> & { readonly loteId: string; readonly reservaId: string },
  ): Promise<RecogidaDeLote<T>> {
    comprobar(peticion);
    const modelo = elegirModelo(peticion.nivel, modelos);
    const lotes = config.proveedor.lotes;
    if (lotes === undefined)
      throw new Error(`El proveedor ${config.proveedor.id} no tiene modo lote.`);

    const resumen = await lotes.consultar(peticion.loteId);
    if (resumen.estado === 'en-proceso') return { estado: 'en-proceso', resumen };

    const inicio = reloj();
    const trazaId = generarId();
    const crudos = await lotes.resultados(peticion.loteId);
    const porId = new Map(crudos.map((r) => [r.id, r]));

    const usoDelLote = crudos.reduce<Uso>(
      (total, r) => (r.tipo === 'ok' ? sumarUso(total, r.respuesta.uso) : total),
      USO_VACIO,
    );
    const costeDelLoteEur = costeEnEuros(modelo, usoDelLote, { ...opcionesDeCoste, lote: true });
    const costeSinLoteEur = costeEnEuros(modelo, usoDelLote, opcionesDeCoste);

    // El lote se liquida entero de una vez: es una sola reserva y un solo cargo
    // del proveedor.
    await config.presupuesto.liquidar({
      reservaId: peticion.reservaId,
      tenantId: peticion.tenantId,
      agente: peticion.agente,
      modelo: modelo.id,
      uso: usoDelLote,
      costeEur: costeDelLoteEur,
      cacheAcertada: usoDelLote.cacheLeida > 0,
      modo: 'lote',
      referencia: peticion.referencia ?? `${peticion.tarea}#lote:${peticion.loteId}`,
    });

    const resultados: ResultadoDeElemento<T>[] = [];
    let costeDeReintentosEur = 0;
    let usoDeReintentos: Uso = USO_VACIO;

    for (const elemento of peticion.elementos) {
      const crudo = porId.get(elemento.id);
      const texto = crudo?.tipo === 'ok' ? crudo.respuesta.texto : undefined;

      if (texto !== undefined && peticion.esquema === undefined) {
        resultados.push({ id: elemento.id, estado: 'texto', texto });
        continue;
      }
      if (texto !== undefined && peticion.esquema !== undefined) {
        const validacion = validarSalida(texto, peticion.esquema);
        if (validacion.valida) {
          resultados.push({
            id: elemento.id,
            estado: 'valida',
            datos: validacion.datos,
            reintentado: false,
          });
          continue;
        }
      }

      // El único reintento de una petición del lote que ha fallado o no valida
      // se hace fuera del lote: esperar a otro lote por un elemento es
      // desproporcionado, y son pocos.
      const errorDelLote =
        crudo === undefined
          ? 'El lote no ha devuelto esta petición.'
          : crudo.tipo === 'error'
            ? crudo.mensaje
            : 'La salida del lote no cumple el esquema.';
      const reintento = await generar<T>({
        ...peticion,
        mensaje: elemento.mensaje,
        referencia: `${peticion.tarea}#lote:${peticion.loteId}:${elemento.id}`,
      });
      costeDeReintentosEur += reintento.costeEur;
      usoDeReintentos = sumarUso(usoDeReintentos, reintento.uso);
      if (reintento.estado === 'valida') {
        resultados.push({
          id: elemento.id,
          estado: 'valida',
          datos: reintento.datos,
          reintentado: true,
        });
      } else {
        resultados.push({
          id: elemento.id,
          estado: 'fallida',
          errores:
            reintento.estado === 'fallida'
              ? reintento.errores
              : [errorDelLote, reintento.estado === 'texto' ? 'Sin esquema.' : reintento.mensaje],
          reintentado: true,
        });
      }
    }

    const costeEur = Math.round((costeDelLoteEur + costeDeReintentosEur) * 1e6) / 1e6;
    const validas = resultados.filter((r) => r.estado !== 'fallida').length;

    await avisarSiFalla(
      trazador.registrar({
        id: trazaId,
        tenantId: peticion.tenantId,
        agente: peticion.agente,
        tarea: peticion.tarea,
        ...(peticion.plantilla === undefined ? {} : { plantilla: peticion.plantilla }),
        nivel: peticion.nivel,
        modelo: modelo.id,
        proveedor: config.proveedor.id,
        modo: 'lote',
        resultado: validas === resultados.length ? 'valida' : 'fallida',
        intentos: [
          {
            numero: 1,
            modelo: modelo.id,
            uso: usoDelLote,
            costeEur: costeDelLoteEur,
            texto: `${String(crudos.length)} respuestas del lote ${peticion.loteId}`,
            inicio,
            fin: reloj(),
            idDelProveedor: peticion.loteId,
          },
        ],
        costeEur,
        uso: sumarUso(usoDelLote, usoDeReintentos),
        cacheAcertada: usoDelLote.cacheLeida > 0,
        entrada: {
          sistema: peticion.bloquesFijos.join('\n\n'),
          mensaje: `${String(peticion.elementos.length)} elementos`,
        },
        salida: `${String(validas)} de ${String(resultados.length)} válidas`,
        inicio,
        fin: reloj(),
      }),
      'registrar la traza del lote en Langfuse',
      trazaId,
    );

    return {
      estado: 'terminado',
      trazaId,
      modelo: modelo.id,
      resultados,
      costeEur,
      costeDelLoteEur,
      costeDeReintentosEur: Math.round(costeDeReintentosEur * 1e6) / 1e6,
      costeSinLoteEur,
      costePorElementoEur: Math.round((costeDelLoteEur / Math.max(1, crudos.length)) * 1e6) / 1e6,
      uso: sumarUso(usoDelLote, usoDeReintentos),
      cacheAcertada: usoDelLote.cacheLeida > 0,
    };
  }

  return {
    generar,
    crearLote,
    recogerLote,
    modeloPara: (nivel) => elegirModelo(nivel, modelos),
  };
}
