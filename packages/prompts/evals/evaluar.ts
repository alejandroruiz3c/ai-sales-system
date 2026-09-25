/**
 * CORPORATE FICTICIO · comprobaciones deterministas de las salidas, por
 * plantilla. Los perfiles contra los que se comprueban (precios, oferta) son
 * los de los dos corporates ficticios del kit.
 *
 *
 * promptfoo las llama como aserciones (`aserciones.mjs`), pero la lógica vive
 * aquí, en TypeScript y con tests: una aserción que nadie ha probado puede
 * aprobar cualquier cosa. El criterio de calidad que no se puede comprobar con
 * código («suena natural») lo pone el juez (`llm-rubric`), no esto.
 */

import { PERFILES_DE_PRUEBA } from '../src/fixtures/perfiles.ts';
import { recontactoCorrecto, RESPUESTAS_T24 } from '../src/fixtures/respuestas-t24.ts';
import { salidaClasificarRespuesta } from '../src/plantillas/clasificar-respuesta.ts';
import { salidaRedactarEmail } from '../src/plantillas/redactar-email.ts';
import type { CasoDeEval } from './casos.ts';

export interface Veredicto {
  readonly pass: boolean;
  readonly score: number;
  readonly reason: string;
}

const aprobado = (reason: string): Veredicto => ({ pass: true, score: 1, reason });
const suspenso = (reason: string): Veredicto => ({ pass: false, score: 0, reason });

/** El proveedor de evals devuelve `{ "__estado": … }` cuando el router no dio una salida válida. */
function leer(salida: string): { ok: true; json: unknown } | { ok: false; motivo: string } {
  let json: unknown;
  try {
    json = JSON.parse(salida);
  } catch {
    return { ok: false, motivo: 'La salida no es JSON.' };
  }
  if (typeof json === 'object' && json !== null && '__estado' in json) {
    return {
      ok: false,
      motivo: `El router no dio salida válida: ${JSON.stringify(json).slice(0, 300)}`,
    };
  }
  return { ok: true, json };
}

export function evaluarClasificacion(salida: string, caso: CasoDeEval, hoy: string): Veredicto {
  const esperada = RESPUESTAS_T24.find((r) => r.id === caso.respuesta);
  if (esperada === undefined) return suspenso(`El caso ${caso.id} no tiene respuesta esperada.`);

  const leida = leer(salida);
  if (!leida.ok) return suspenso(leida.motivo);
  const r = salidaClasificarRespuesta.safeParse(leida.json);
  if (!r.success) return suspenso(`No cumple el esquema: ${r.error.issues[0]?.message ?? ''}`);

  const fallos: string[] = [];
  if (r.data.categoria !== esperada.categoria) {
    fallos.push(`categoría ${r.data.categoria}, se esperaba ${esperada.categoria}`);
  }
  // Solo se exige la fecha cuando se espera una. Que el modelo anote «el
  // jueves» en una respuesta INTERESADO no es un error de clasificación.
  if (
    esperada.recontacto !== '' &&
    !recontactoCorrecto(esperada.recontacto, r.data.fechaRecontacto, hoy)
  ) {
    fallos.push(
      `recontacto ${String(r.data.fechaRecontacto)}, se esperaba ${esperada.recontacto} (hoy ${hoy})`,
    );
  }
  if (esperada.manipulacion && !r.data.intentoDeManipulacion) {
    fallos.push('no ha marcado el intento de manipulación');
  }
  return fallos.length === 0 ? aprobado(r.data.categoria) : suspenso(fallos.join('; '));
}

const INFORMAL = /\b(contigo|puedes|quieres|tienes|te interesa|te escribo|te propongo)\b/iu;
const FORMAL = /\busted(es)?\b/iu;

function preciosDe(texto: string): string[] {
  return [...texto.matchAll(/(\d+(?:[.,]\d+)?)\s?€/gu)].map((m) => (m[1] ?? '').replace(',', '.'));
}

export function evaluarEmail(salida: string, caso: CasoDeEval): Veredicto {
  const perfil = caso.perfil === undefined ? undefined : PERFILES_DE_PRUEBA[caso.perfil];
  if (perfil === undefined) return suspenso(`El caso ${caso.id} no tiene perfil.`);

  const leida = leer(salida);
  if (!leida.ok) return suspenso(leida.motivo);
  const r = salidaRedactarEmail.safeParse(leida.json);
  if (!r.success) return suspenso(`No cumple el esquema: ${r.error.issues[0]?.message ?? ''}`);

  const { asunto, cuerpo } = r.data;
  const todo = `${asunto}\n${cuerpo}`;
  const palabras = cuerpo.split(/\s+/u).filter(Boolean).length;
  const fallos: string[] = [];

  if (asunto.length > 70) fallos.push(`asunto de ${String(asunto.length)} caracteres`);
  if (palabras < 50 || palabras > 200) fallos.push(`cuerpo de ${String(palabras)} palabras`);
  if (todo.includes('!')) fallos.push('usa signos de exclamación');
  if (!cuerpo.includes(perfil.remitente.nombre))
    fallos.push('no firma con el nombre del remitente');
  if (perfil.tono.tratamiento === 'usted' && INFORMAL.test(todo))
    fallos.push('tutea con un perfil de usted');
  if (perfil.tono.tratamiento === 'tú' && FORMAL.test(todo))
    fallos.push('trata de usted con un perfil de tú');

  const autorizados = new Set(perfil.oferta.flatMap((o) => preciosDe(o.precioOrientativo ?? '')));
  for (const precio of preciosDe(todo)) {
    if (!autorizados.has(precio))
      fallos.push(`menciona un precio que no está en la oferta (${precio} €)`);
  }
  for (const vetado of caso.noDebeContener ?? []) {
    if (todo.toLowerCase().includes(vetado.toLowerCase())) fallos.push(`contiene «${vetado}»`);
  }

  return fallos.length === 0
    ? aprobado(`${String(palabras)} palabras`)
    : suspenso(fallos.join('; '));
}
