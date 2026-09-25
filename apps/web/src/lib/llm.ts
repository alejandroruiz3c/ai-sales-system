import 'server-only';

/**
 * El router de modelos del panel: un sitio, una forma de construirlo.
 *
 * Todo lo que el plano de control haga con un modelo (hoy, `/lab` y el lote de
 * Inngest; mañana, los agentes y el Estudio) pasa por aquí. Aquí se decide lo
 * que depende del entorno y no del agente:
 *
 *   · el proveedor, con la clave de Vercel;
 *   · el presupuesto, que es la base (`app.autorizar_gasto` / `app.liquidar_gasto`);
 *   · la traza, en Langfuse si está configurado;
 *   · el tipo de cambio dólar-euro.
 *
 * El presupuesto corre **como sistema** porque los dos usos de F2 no tienen
 * sesión de usuario: `/lab` se entra con la contraseña de plataforma y actúa
 * solo sobre corporates de prueba, e Inngest no tiene usuario. Cuando el
 * Estudio deje probar a un editor (F2B.6), su router se construirá con
 * `conRLS` y el mismo adaptador.
 */

import { crearPresupuestoDeGasto } from '@sales-os/db';
import {
  crearRouter,
  idDeTrazaOtel,
  ProveedorAnthropic,
  ProveedorConFallos,
  TIPO_CAMBIO_USD_EUR_POR_DEFECTO,
  TrazadorLangfuse,
  TRAZADOR_NULO,
  type ModelProvider,
  type Router,
  type Trazador,
} from '@sales-os/llm';

import { z } from 'zod';

import { baseDeDatos } from './base-de-datos.ts';
import { env } from './env.ts';
import { log } from './log.ts';

export class ModelosNoConfigurados extends Error {
  constructor() {
    super(
      'Falta ANTHROPIC_API_KEY en el entorno. Se configura en Vercel → Settings → Environment Variables, en Production (staging) y Preview.',
    );
    this.name = 'ModelosNoConfigurados';
  }
}

export function tipoDeCambio(): number {
  const valor = Number(env.tipoCambioUsdEur);
  return Number.isFinite(valor) && valor > 0 ? valor : TIPO_CAMBIO_USD_EUR_POR_DEFECTO;
}

export function langfuseConfigurado(): boolean {
  return (
    env.langfuseHost !== undefined &&
    env.langfusePublicKey !== undefined &&
    env.langfuseSecretKey !== undefined
  );
}

function trazador(): Trazador {
  if (
    env.langfuseHost === undefined ||
    env.langfusePublicKey === undefined ||
    env.langfuseSecretKey === undefined
  ) {
    return TRAZADOR_NULO;
  }
  return new TrazadorLangfuse({
    host: env.langfuseHost,
    clavePublica: env.langfusePublicKey,
    claveSecreta: env.langfuseSecretKey,
    entorno: env.salesOsEnv,
  });
}

export interface OpcionesDeRouter {
  /**
   * Motivo del acceso como sistema, que queda en el log de usos de
   * `service_role`. Si no se puede explicar en una frase, no hace falta.
   */
  readonly motivo: string;
  /** Solo `/lab`, caso T2.5: estropea a propósito las primeras N respuestas. */
  readonly respuestasEstropeadas?: number;
}

export function routerDelSistema(opciones: OpcionesDeRouter): Router {
  if (env.anthropicApiKey === undefined) throw new ModelosNoConfigurados();

  const real: ModelProvider = new ProveedorAnthropic({ apiKey: env.anthropicApiKey });
  const proveedor =
    opciones.respuestasEstropeadas !== undefined && opciones.respuestasEstropeadas > 0
      ? new ProveedorConFallos(real, opciones.respuestasEstropeadas)
      : real;

  return crearRouter({
    proveedor,
    presupuesto: crearPresupuestoDeGasto((fn) => baseDeDatos().comoSistema(opciones.motivo, fn)),
    trazador: trazador(),
    tipoCambioUsdEur: tipoDeCambio(),
    alAvisar: (mensaje, datos) => {
      log().warn(mensaje, datos);
    },
  });
}

// ── Enlace a la traza ────────────────────────────────────────────────────────

// Lo que viene de la API de Langfuse es contenido externo: se valida.
const PROYECTOS = z.object({ data: z.array(z.object({ id: z.string() })) });
const OBSERVACIONES = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      userId: z.string().nullish(),
      traceName: z.string().nullish(),
      totalCost: z.number().nullish(),
      tags: z.array(z.string()).nullish(),
    }),
  ),
});

let proyectoDeLangfuse: Promise<string | undefined> | undefined;

/**
 * El identificador del proyecto de Langfuse, para enlazar una traza.
 *
 * Se pregunta una vez por proceso a su API: las claves pertenecen a un único
 * proyecto, y guardarlo en una variable de entorno sería otra cosa que puede
 * quedar desincronizada.
 */
function proyecto(): Promise<string | undefined> {
  if (proyectoDeLangfuse !== undefined) return proyectoDeLangfuse;
  proyectoDeLangfuse = (async () => {
    const cuerpo = PROYECTOS.safeParse(await consultarLangfuse('/api/public/projects'));
    return cuerpo.success ? cuerpo.data.data[0]?.id : undefined;
  })();
  return proyectoDeLangfuse;
}

async function consultarLangfuse(ruta: string): Promise<unknown> {
  if (
    env.langfuseHost === undefined ||
    env.langfusePublicKey === undefined ||
    env.langfuseSecretKey === undefined
  ) {
    return undefined;
  }
  const credencial = Buffer.from(`${env.langfusePublicKey}:${env.langfuseSecretKey}`).toString(
    'base64',
  );
  const respuesta = await fetch(`${env.langfuseHost.replace(/\/$/, '')}${ruta}`, {
    headers: { authorization: `Basic ${credencial}` },
    cache: 'no-store',
  });
  if (!respuesta.ok) return undefined;
  return respuesta.json();
}

export async function enlaceDeTraza(trazaId: string): Promise<string | undefined> {
  const id = await proyecto().catch(() => undefined);
  if (id === undefined || env.langfuseHost === undefined) return undefined;
  return `${env.langfuseHost.replace(/\/$/, '')}/project/${id}/traces/${idDeTrazaOtel(trazaId)}`;
}

export interface TrazaComprobada {
  readonly existe: boolean;
  readonly tenant?: string;
  readonly agente?: string;
  readonly costeEur?: number;
  readonly generaciones?: number;
  readonly etiquetas?: readonly string[];
}

/**
 * Lo que Langfuse tiene de una traza (caso T2.6).
 *
 * Existe para que el E2E y quien ejecuta el kit puedan comprobar sin abrir
 * Langfuse que la traza llegó separada por tenant y por agente y con coste. La
 * ingesta de Langfuse es asíncrona: una traza recién enviada puede tardar unos
 * segundos en aparecer.
 */
export async function comprobarTraza(trazaId: string): Promise<TrazaComprobada> {
  // La API de trazas antigua no existe para organizaciones creadas después del
  // 16 de septiembre de 2026: se lee de la de observaciones, por traza.
  const leida = OBSERVACIONES.safeParse(
    await consultarLangfuse(
      // `cost` solo viene relleno si también se pide `usage` (comprobado contra
      // Langfuse Cloud el 2026-09-25; su documentación no lo dice).
      `/api/public/v2/observations?traceId=${idDeTrazaOtel(trazaId)}&fields=core,basic,usage,cost,trace_context`,
    ),
  );
  if (!leida.success || leida.data.data.length === 0) return { existe: false };
  const observaciones = leida.data.data;
  const raiz = observaciones.find((o) => (o.userId ?? '') !== '') ?? observaciones[0];
  const generaciones = observaciones.filter((o) => o.type === 'GENERATION');
  const coste = generaciones.reduce((t, o) => t + (o.totalCost ?? 0), 0);
  return {
    existe: true,
    ...(raiz?.userId == null || raiz.userId === '' ? {} : { tenant: raiz.userId }),
    ...(raiz?.traceName == null ? {} : { agente: raiz.traceName }),
    costeEur: Math.round(coste * 1e6) / 1e6,
    generaciones: generaciones.length,
    etiquetas: raiz?.tags ?? [],
  };
}
