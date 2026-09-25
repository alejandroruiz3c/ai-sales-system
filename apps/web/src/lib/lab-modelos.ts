import 'server-only';

/**
 * El probador de modelos y el lote de la sala de pruebas (F2, casos T2.1–T2.6).
 *
 * Lo mismo que el resto de `/lab`: **solo actúa sobre corporates de prueba**,
 * y cobra en su presupuesto de verdad. No hay un camino «de prueba» que se
 * salte el router: lo que se ve aquí es lo que harán los agentes, con el mismo
 * modelo, la misma caché, la misma validación y el mismo corte.
 */

import { modeloPorId, NIVELES, type Nivel, type ResultadoDeGeneracion } from '@sales-os/llm';
import {
  CATEGORIAS_DE_RESPUESTA,
  IDS_DE_PLANTILLA,
  PLANTILLAS,
  renderizar,
  salidaClasificarRespuesta,
  type Plantilla,
} from '@sales-os/prompts';
import {
  IDS_DE_PERFIL_DE_PRUEBA,
  PERFILES_DE_PRUEBA,
  recontactoCorrecto,
  RESPUESTAS_T24,
} from '@sales-os/prompts/fixtures';
import { z } from 'zod';

import { baseDeDatos } from './base-de-datos.ts';
import { inngest, NOMBRE_LOTE_LLM_ENVIADO, type LoteLlmEnviado } from './inngest/client.ts';
import { esDemo } from './lab-pruebas.ts';
import { enlaceDeTraza, routerDelSistema } from './llm.ts';

/** Con qué agente se cobran y se trazan las pruebas de `/lab`. */
export const AGENTE_DEL_PROBADOR = 'lab-probador';

/** Hoy, en la zona del sistema. La fecha entra en el mensaje, nunca en el bloque cacheado. */
export function hoyEnMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora);
}

export const esquemaDePrueba = z.discriminatedUnion('modo', [
  z.object({
    modo: z.literal('plantilla'),
    tenantId: z.uuid({ error: 'Elige un corporate de prueba.' }),
    plantilla: z.enum(IDS_DE_PLANTILLA, { error: 'Esa plantilla no existe.' }),
    perfil: z.enum(IDS_DE_PERFIL_DE_PRUEBA).optional(),
    entrada: z.record(z.string(), z.unknown()),
    /** Caso T2.5: estropear a propósito las primeras N respuestas (0, 1 o 2). */
    estropear: z.number().int().min(0).max(2).default(0),
  }),
  z.object({
    modo: z.literal('libre'),
    tenantId: z.uuid({ error: 'Elige un corporate de prueba.' }),
    nivel: z.enum(NIVELES),
    prompt: z.string().trim().min(1, 'Escribe un prompt.').max(4000),
  }),
]);

export type PeticionDePrueba = z.input<typeof esquemaDePrueba>;

export interface ResultadoDePrueba {
  readonly estado: ResultadoDeGeneracion<unknown>['estado'];
  readonly modelo: string;
  readonly nombreDelModelo: string;
  readonly nivel: Nivel;
  readonly costeEur: number;
  readonly uso: ResultadoDeGeneracion<unknown>['uso'];
  readonly cacheAcertada: boolean;
  readonly avisoDeCache?: string;
  readonly intentos: number;
  readonly trazaId: string;
  readonly enlaceDeTraza?: string;
  readonly plantilla?: string;
  readonly datos?: unknown;
  readonly texto?: string;
  readonly errores?: readonly string[];
  readonly mensaje?: string;
}

async function exigirDemo(tenantId: string): Promise<void> {
  if (!(await esDemo(tenantId))) {
    throw new Error('La sala de pruebas solo actúa sobre corporates de prueba.');
  }
}

/** El probador de modelos: una llamada, con modelo, coste, caché e intentos a la vista. */
export async function probarModelo(peticion: unknown): Promise<ResultadoDePrueba> {
  const p = esquemaDePrueba.parse(peticion);
  await exigirDemo(p.tenantId);

  const router = routerDelSistema({
    motivo: 'Probador de modelos de /lab sobre un corporate de prueba (F2)',
    ...(p.modo === 'plantilla' ? { respuestasEstropeadas: p.estropear } : {}),
  });

  let r: ResultadoDeGeneracion<unknown>;
  let plantilla: string | undefined;

  if (p.modo === 'plantilla') {
    const elegida: Plantilla = PLANTILLAS[p.plantilla];
    if (elegida.usaPerfil && p.perfil === undefined) {
      throw new Error('Esta plantilla necesita un perfil comercial de prueba.');
    }
    const prompt = renderizar(elegida, {
      ...(p.perfil === undefined ? {} : { perfil: PERFILES_DE_PRUEBA[p.perfil] }),
      entrada: p.entrada,
      hoy: hoyEnMadrid(),
    });
    plantilla = `${prompt.plantilla.id} v${prompt.plantilla.version}`;
    r = await router.generar({ ...prompt, tenantId: p.tenantId, agente: AGENTE_DEL_PROBADOR });
  } else {
    r = await router.generar({
      tenantId: p.tenantId,
      agente: AGENTE_DEL_PROBADOR,
      tarea: 'prompt-libre',
      nivel: p.nivel,
      bloquesFijos: ['Responde en castellano, de forma breve y directa.'],
      mensaje: p.prompt,
      maxTokens: 800,
    });
  }

  const enlace = await enlaceDeTraza(r.trazaId).catch(() => undefined);
  return {
    estado: r.estado,
    modelo: r.modelo,
    nombreDelModelo: modeloPorId(r.modelo)?.nombre ?? r.modelo,
    nivel: r.nivel,
    costeEur: r.costeEur,
    uso: r.uso,
    cacheAcertada: r.cacheAcertada,
    ...(r.avisoDeCache === undefined ? {} : { avisoDeCache: r.avisoDeCache }),
    intentos: r.intentos,
    trazaId: r.trazaId,
    ...(enlace === undefined ? {} : { enlaceDeTraza: enlace }),
    ...(plantilla === undefined ? {} : { plantilla }),
    ...(r.estado === 'valida' ? { datos: r.datos } : {}),
    ...(r.estado === 'texto' || r.estado === 'valida' || r.estado === 'fallida'
      ? { texto: r.texto }
      : {}),
    ...(r.estado === 'fallida' ? { errores: r.errores } : {}),
    ...(r.estado === 'error' || r.estado === 'bloqueada' ? { mensaje: r.mensaje } : {}),
  };
}

// ── El lote de T2.4 ──────────────────────────────────────────────────────────

/** La definición del lote: la misma al enviarlo y al recogerlo, porque sale de los fixtures y de la fecha. */
function definicionDelLote(tenantId: string, hoy: string) {
  const plantilla = PLANTILLAS['clasificar-respuesta'];
  const elementos = RESPUESTAS_T24.map((r) => {
    const prompt = renderizar(plantilla, { entrada: { respuesta: r.texto, canal: 'email' }, hoy });
    return { id: r.id, mensaje: prompt.mensaje, bloquesFijos: prompt.bloquesFijos, prompt };
  });
  const primero = elementos[0]?.prompt;
  if (primero === undefined) throw new Error('El fichero de T2.4 está vacío.');
  return {
    tenantId,
    agente: AGENTE_DEL_PROBADOR,
    tarea: primero.tarea,
    nivel: primero.nivel,
    bloquesFijos: primero.bloquesFijos,
    esquema: salidaClasificarRespuesta,
    formatoEstricto: primero.formatoEstricto,
    maxTokens: primero.maxTokens,
    plantilla: primero.plantilla,
    elementos: elementos.map((e) => ({ id: e.id, mensaje: e.mensaje })),
  };
}

export interface LoteLanzado {
  readonly estado: 'creado' | 'bloqueada';
  readonly loteId?: string;
  readonly modelo: string;
  readonly elementos?: number;
  readonly costeMaximoEur?: number;
  readonly mensaje?: string;
}

/** Caso T2.4: lanza en modo lote la clasificación de las 20 respuestas del fichero. */
export async function lanzarLoteT24(tenantId: string): Promise<LoteLanzado> {
  z.uuid().parse(tenantId);
  await exigirDemo(tenantId);
  const hoy = hoyEnMadrid();
  const router = routerDelSistema({
    motivo: 'Lote de T2.4 desde /lab sobre un corporate de prueba (F2.3)',
  });
  const creado = await router.crearLote(definicionDelLote(tenantId, hoy));

  if (creado.estado === 'bloqueada') {
    return { estado: 'bloqueada', modelo: creado.modelo, mensaje: creado.mensaje };
  }

  // Primero la tabla `events`, que es la fuente de verdad (ADR 0002); después
  // Inngest. Si Inngest perdiera el evento, el lote seguiría constando como
  // enviado y el reproceso sabría qué reinyectar.
  await baseDeDatos().comoSistema('Anotar el lote de T2.4 enviado desde /lab (F2.3)', (ctx) =>
    ctx.consultar(
      `select app.registrar_evento($1::uuid, 'llm.batch.submitted',
         jsonb_build_object('lote_id', $2::text, 'reserva_id', $3::text, 'hoy', $4::text,
                            'modelo', $5::text, 'elementos', $6::int, 'coste_maximo_eur', $7::numeric),
         $8, 'lab')`,
      [
        tenantId,
        creado.loteId,
        creado.reservaId,
        hoy,
        creado.modelo,
        creado.elementos,
        creado.costeMaximoEur,
        AGENTE_DEL_PROBADOR,
      ],
    ),
  );
  const datos: LoteLlmEnviado = {
    tenantId,
    loteId: creado.loteId,
    reservaId: creado.reservaId,
    hoy,
  };
  await inngest.send({ name: NOMBRE_LOTE_LLM_ENVIADO, data: datos });

  return {
    estado: 'creado',
    loteId: creado.loteId,
    modelo: creado.modelo,
    elementos: creado.elementos,
    costeMaximoEur: creado.costeMaximoEur,
  };
}

export interface ElementoCorregido {
  readonly id: string;
  readonly texto: string;
  readonly esperada: string;
  readonly obtenida: string | null;
  readonly recontactoEsperado: string;
  readonly recontactoObtenido: string | null;
  readonly acierto: boolean;
  readonly reintentado: boolean;
}

/**
 * Una consulta del lote: si ha terminado, lo recoge, lo corrige contra el
 * fichero y lo anota. La llama la función de Inngest en cada paso.
 */
export async function recogerLoteT24(
  lote: LoteLlmEnviado,
): Promise<{ readonly terminado: boolean }> {
  const router = routerDelSistema({ motivo: 'Recoger el lote de T2.4 desde Inngest (F2.3)' });
  const r = await router.recogerLote({
    ...definicionDelLote(lote.tenantId, lote.hoy),
    loteId: lote.loteId,
    reservaId: lote.reservaId,
  });
  if (r.estado === 'en-proceso') return { terminado: false };

  const corregidos: ElementoCorregido[] = RESPUESTAS_T24.map((esperada) => {
    const obtenido = r.resultados.find((x) => x.id === esperada.id);
    const datos = obtenido?.estado === 'valida' ? obtenido.datos : undefined;
    const categoriaOk = datos?.categoria === esperada.categoria;
    const fechaOk =
      esperada.recontacto === '' ||
      recontactoCorrecto(esperada.recontacto, datos?.fechaRecontacto ?? null, lote.hoy);
    return {
      id: esperada.id,
      texto: esperada.texto,
      esperada: esperada.categoria,
      obtenida: datos?.categoria ?? null,
      recontactoEsperado: esperada.recontacto,
      recontactoObtenido: datos?.fechaRecontacto ?? null,
      acierto: categoriaOk && fechaOk,
      reintentado:
        obtenido !== undefined && 'reintentado' in obtenido ? obtenido.reintentado : false,
    };
  });

  const aciertos = corregidos.filter((c) => c.acierto).length;
  await baseDeDatos().comoSistema('Anotar el resultado del lote de T2.4 (F2.3)', (ctx) =>
    ctx.consultar(
      `select app.registrar_evento($1::uuid, 'llm.batch.completed', $2::text::jsonb, $3, 'inngest')`,
      [
        lote.tenantId,
        JSON.stringify({
          lote_id: lote.loteId,
          traza_id: r.trazaId,
          modelo: r.modelo,
          aciertos,
          total: corregidos.length,
          coste_eur: r.costeEur,
          coste_del_lote_eur: r.costeDelLoteEur,
          coste_de_reintentos_eur: r.costeDeReintentosEur,
          coste_sin_lote_eur: r.costeSinLoteEur,
          coste_por_elemento_eur: r.costePorElementoEur,
          cache_acertada: r.cacheAcertada,
          resultados: corregidos,
        }),
        AGENTE_DEL_PROBADOR,
      ],
    ),
  );
  return { terminado: true };
}

// ── Lo que `/lab` enseña de los lotes ────────────────────────────────────────

const esquemaCompletado = z.object({
  lote_id: z.string(),
  traza_id: z.string(),
  modelo: z.string(),
  aciertos: z.number(),
  total: z.number(),
  coste_eur: z.number(),
  coste_del_lote_eur: z.number(),
  coste_de_reintentos_eur: z.number(),
  coste_sin_lote_eur: z.number(),
  coste_por_elemento_eur: z.number(),
  resultados: z.array(
    z.object({
      id: z.string(),
      texto: z.string(),
      esperada: z.enum(CATEGORIAS_DE_RESPUESTA),
      obtenida: z.string().nullable(),
      recontactoEsperado: z.string(),
      recontactoObtenido: z.string().nullable(),
      acierto: z.boolean(),
      reintentado: z.boolean(),
    }),
  ),
});

export interface LoteEnLab {
  readonly loteId: string;
  readonly tenant: string;
  readonly enviadoEn: string;
  readonly modelo: string;
  readonly terminado: boolean;
  readonly resultado?: z.infer<typeof esquemaCompletado> & { readonly enlaceDeTraza?: string };
}

/** Los últimos lotes de los corporates de prueba, con su resultado si ya volvieron. */
export async function lotesRecientes(): Promise<readonly LoteEnLab[]> {
  const filas = await baseDeDatos().comoSistema(
    'Listar los lotes de T2.4 de los corporates de prueba para /lab (F2.3)',
    (ctx) =>
      ctx.consultar<{
        nombre: string;
        datos: Record<string, unknown>;
        creado_en: string;
        tenant: string;
      }>(
        `select e.nombre, e.datos, e.creado_en::text, t.nombre as tenant
         from public.events e
         join public.tenants t on t.id = e.tenant_id
         where t.es_demo = true
           and e.nombre in ('llm.batch.submitted', 'llm.batch.completed')
         order by e.creado_en desc
         limit 40`,
      ),
  );

  const completados = new Map<string, z.infer<typeof esquemaCompletado>>();
  for (const f of filas) {
    if (f.nombre !== 'llm.batch.completed') continue;
    const leido = esquemaCompletado.safeParse(f.datos);
    if (leido.success) completados.set(leido.data.lote_id, leido.data);
  }

  const lotes: LoteEnLab[] = [];
  for (const f of filas) {
    if (f.nombre !== 'llm.batch.submitted') continue;
    const loteId = typeof f.datos['lote_id'] === 'string' ? f.datos['lote_id'] : '';
    const resultado = completados.get(loteId);
    const enlace =
      resultado === undefined
        ? undefined
        : await enlaceDeTraza(resultado.traza_id).catch(() => undefined);
    lotes.push({
      loteId,
      tenant: f.tenant,
      enviadoEn: f.creado_en,
      modelo: typeof f.datos['modelo'] === 'string' ? f.datos['modelo'] : '',
      terminado: resultado !== undefined,
      ...(resultado === undefined
        ? {}
        : {
            resultado: { ...resultado, ...(enlace === undefined ? {} : { enlaceDeTraza: enlace }) },
          }),
    });
    if (lotes.length >= 5) break;
  }
  return lotes;
}
