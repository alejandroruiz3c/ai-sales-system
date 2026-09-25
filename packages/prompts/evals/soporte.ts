/**
 * Lo que los adaptadores de promptfoo necesitan para llamar al sistema de
 * verdad: el router de `@sales-os/llm`, con las plantillas de este paquete.
 *
 * Las evals **no** llaman al SDK del proveedor por su cuenta: pasan por el
 * mismo router que producción, con la misma elección de modelo, la misma caché
 * y la misma validación con un único reintento. Lo que se evalúa es lo que se
 * despliega.
 *
 * El coste de las evals es de la plataforma, no de ningún tenant: se cobra en
 * un presupuesto en memoria con tope, y cada llamada se anota en un fichero
 * de registro que `ejecutar.ts` suma al final.
 */

import { appendFileSync } from 'node:fs';

import {
  crearRouter,
  PresupuestoEnMemoria,
  ProveedorAnthropic,
  TIPO_CAMBIO_USD_EUR_POR_DEFECTO,
  type ResultadoDeGeneracion,
  type Router,
} from '@sales-os/llm';
import { z } from 'zod';

import { PERFILES_DE_PRUEBA, type IdDePerfilDePrueba } from '../src/fixtures/perfiles.ts';
import { renderizar, type Plantilla } from '../src/plantilla.ts';
import { esIdDePlantilla, PLANTILLAS } from '../src/registro.ts';

/** El tenant con el que se trazan y cobran las evals. No es un corporate. */
const TENANT_DE_EVALS = 'plataforma-evals';
/** Tope por proceso de promptfoo. Una ejecución completa cuesta céntimos. */
const TOPE_EUR = 2;

let router: Router | undefined;

function elRouter(): Router {
  if (router !== undefined) return router;
  const clave = process.env['ANTHROPIC_API_KEY'];
  if (clave === undefined || clave === '') {
    throw new Error(
      'Falta ANTHROPIC_API_KEY. `pnpm evals` la lee de apps/web/.env.local (vercel env pull apps/web/.env.local --environment development).',
    );
  }
  router = crearRouter({
    proveedor: new ProveedorAnthropic({ apiKey: clave }),
    presupuesto: new PresupuestoEnMemoria(TOPE_EUR),
    tipoCambioUsdEur: TIPO_CAMBIO_USD_EUR_POR_DEFECTO,
  });
  return router;
}

function registrar(tipo: 'caso' | 'juez', resultado: ResultadoDeGeneracion<unknown>): void {
  const destino = process.env['SALES_OS_EVALS_REGISTRO'];
  if (destino === undefined) return;
  appendFileSync(
    destino,
    `${JSON.stringify({ tipo, coste: resultado.costeEur, modelo: resultado.modelo, estado: resultado.estado, intentos: resultado.intentos })}\n`,
  );
}

export interface SalidaDeProveedor {
  readonly output: string;
  readonly cost: number;
  readonly tokenUsage: {
    readonly prompt: number;
    readonly completion: number;
    readonly cached: number;
    readonly total: number;
  };
}

function aSalida(r: ResultadoDeGeneracion<unknown>, output: string): SalidaDeProveedor {
  const entrada = r.uso.entrada + r.uso.cacheEscrita + r.uso.cacheLeida;
  return {
    output,
    cost: r.costeEur,
    tokenUsage: {
      prompt: entrada,
      completion: r.uso.salida,
      cached: r.uso.cacheLeida,
      total: entrada + r.uso.salida,
    },
  };
}

/** Ejecuta un caso: renderiza la plantilla con su perfil y su entrada, y llama al router. */
export async function ejecutarCaso(vars: Record<string, unknown>): Promise<SalidaDeProveedor> {
  const id = String(vars['plantilla']);
  if (!esIdDePlantilla(id)) throw new Error(`Plantilla desconocida: ${id}`);
  const plantilla: Plantilla = PLANTILLAS[id];
  const perfilId = typeof vars['perfil'] === 'string' ? vars['perfil'] : '';
  const perfil = perfilId === '' ? undefined : PERFILES_DE_PRUEBA[perfilId as IdDePerfilDePrueba];

  const prompt = renderizar(plantilla, {
    ...(perfil === undefined ? {} : { perfil }),
    entrada: JSON.parse(String(vars['entrada'])) as unknown,
    hoy: String(vars['hoy']),
  });

  const r = await elRouter().generar({ ...prompt, tenantId: TENANT_DE_EVALS, agente: 'evals' });
  registrar('caso', r);
  const output =
    r.estado === 'valida'
      ? JSON.stringify(r.datos)
      : JSON.stringify({
          __estado: r.estado,
          ...(r.estado === 'fallida' ? { errores: r.errores } : {}),
          ...(r.estado === 'error' || r.estado === 'bloqueada' ? { mensaje: r.mensaje } : {}),
        });
  return aSalida(r, output);
}

const veredictoDelJuez = z.object({
  reason: z.string().min(1),
  pass: z.boolean(),
  score: z.number().min(0).max(1),
});

const INSTRUCCIONES_DEL_JUEZ = `Eres un evaluador estricto de textos comerciales en castellano. Recibes una rúbrica y una salida, y decides si la salida cumple la rúbrica entera. Eres exigente: si falla un solo criterio, no aprueba. Responde solo con un objeto JSON con reason (explicación en castellano de menos de 60 palabras), pass (true o false) y score (entre 0 y 1).`;

/** El juez de `llm-rubric`: el modelo medio, por el mismo router. */
export async function juzgar(prompt: string): Promise<SalidaDeProveedor> {
  const r = await elRouter().generar({
    tenantId: TENANT_DE_EVALS,
    agente: 'evals-juez',
    tarea: 'juzgar-rubrica',
    nivel: 'medio',
    bloquesFijos: [INSTRUCCIONES_DEL_JUEZ],
    mensaje: prompt,
    esquema: veredictoDelJuez,
    maxTokens: 1200,
  });
  registrar('juez', r);
  const output =
    r.estado === 'valida'
      ? JSON.stringify(r.datos)
      : JSON.stringify({
          reason: `El juez no dio un veredicto válido (${r.estado}).`,
          pass: false,
          score: 0,
        });
  return aSalida(r, output);
}
