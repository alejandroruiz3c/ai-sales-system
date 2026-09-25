/**
 * Plantillas de prompt versionadas, con variables del perfil (F2.6).
 *
 * Una plantilla es **código**: vive en el repositorio, cambia con PR y pasa sus
 * evals (F2.7). Tiene dos partes, y la frontera entre ellas es la de la caché:
 *
 *   · **bloques fijos**, con nombre («Quién eres», «Qué vendes», «Cómo
 *     escribes», «Qué nunca dices», «Formato de salida»). Solo pueden usar
 *     variables del **perfil comercial**, que es igual en todas las llamadas de
 *     un tenant. Van al prompt de sistema y se cachean (F2.2);
 *   · **mensaje**, lo que cambia en cada llamada: el prospecto, la respuesta a
 *     clasificar, la fecha de hoy. Solo puede usar variables de la **entrada**
 *     y `{{hoy}}`.
 *
 * Mezclarlas no es un error de estilo, es un error de coste: una fecha dentro
 * de un bloque fijo invalida la caché de todas las llamadas del tenant. Por eso
 * `validarPlantilla` lo rechaza y hay un test que valida todas las plantillas
 * del registro.
 *
 * Los bloques con nombre son los que el Estudio enseñará y dejará editar por
 * tenant en F2B: la capa del tenant sustituirá bloques de esta base, no el
 * prompt entero.
 */

import { createHash } from 'node:crypto';

import type { Nivel } from '@sales-os/llm';
import { z } from 'zod';

import { esquemaPerfilComercial, type PerfilComercial } from './perfil.ts';

export interface Bloque {
  readonly nombre: string;
  readonly texto: string;
}

export interface Plantilla<E extends z.ZodType = z.ZodType, T = unknown> {
  readonly id: string;
  /** Versión humana. La identidad exacta es la huella (`huellaDePlantilla`). */
  readonly version: number;
  readonly descripcion: string;
  /** La tarea con la que el router la traza. */
  readonly tarea: string;
  readonly nivel: Nivel;
  readonly maxTokens: number;
  readonly usaPerfil: boolean;
  readonly bloquesFijos: readonly Bloque[];
  readonly mensaje: string;
  readonly esquemaEntrada: E;
  readonly esquemaSalida: z.ZodType<T>;
}

/** Lo que devuelve renderizar: casi una petición del router, sin tenant ni agente. */
export interface PromptRenderizado<T> {
  readonly tarea: string;
  readonly nivel: Nivel;
  readonly maxTokens: number;
  readonly bloquesFijos: readonly string[];
  readonly mensaje: string;
  readonly esquema: z.ZodType<T>;
  readonly plantilla: { readonly id: string; readonly version: string };
}

// ── Variables ────────────────────────────────────────────────────────────────

const VARIABLE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export function variablesDe(texto: string): string[] {
  return [...texto.matchAll(VARIABLE)].map((m) => m[1] ?? '');
}

/** Rutas que existen en un esquema Zod, incluidas las intermedias. */
export function rutasDeEsquema(esquema: z.ZodType, prefijo: string): Set<string> {
  const rutas = new Set<string>();
  const recorrer = (nodo: z.ZodType, ruta: string): void => {
    rutas.add(ruta);
    if (nodo instanceof z.ZodOptional || nodo instanceof z.ZodNullable) {
      recorrer(nodo.unwrap() as z.ZodType, ruta);
    } else if (nodo instanceof z.ZodObject) {
      // `instanceof` no conserva el genérico de la forma: se declara aquí,
      // que es donde se sabe que las propiedades de un objeto Zod son esquemas.
      const forma: Readonly<Record<string, z.ZodType>> = (
        nodo as z.ZodObject<Record<string, z.ZodType>>
      ).shape;
      for (const [clave, hijo] of Object.entries(forma)) {
        recorrer(hijo, `${ruta}.${clave}`);
      }
    }
    // Un array es una hoja: se pinta entero como lista. No hay acceso por
    // índice, porque «el tercer argumento» no significa nada estable.
  };
  recorrer(esquema, prefijo);
  return rutas;
}

export const RUTAS_DEL_PERFIL = rutasDeEsquema(esquemaPerfilComercial, 'perfil');

/**
 * Errores de una plantilla, antes de usarla: variables que no existen y
 * variables en el lado equivocado de la frontera de la caché.
 *
 * Es la comprobación que el Estudio usará para marcar en rojo una variable
 * inexistente (F2B.4), y la que el test aplica a todas las plantillas.
 */
export function validarPlantilla(plantilla: Plantilla): string[] {
  const errores: string[] = [];
  const rutasDeEntrada = rutasDeEsquema(plantilla.esquemaEntrada, 'entrada');

  for (const bloque of plantilla.bloquesFijos) {
    for (const variable of variablesDe(bloque.texto)) {
      if (variable === 'hoy' || variable.startsWith('entrada')) {
        errores.push(
          `El bloque fijo «${bloque.nombre}» usa {{${variable}}}, que cambia en cada llamada: invalidaría la caché. Va en el mensaje.`,
        );
      } else if (!RUTAS_DEL_PERFIL.has(variable)) {
        errores.push(
          `El bloque fijo «${bloque.nombre}» usa {{${variable}}}, que no existe en el perfil comercial.`,
        );
      } else if (!plantilla.usaPerfil) {
        errores.push(
          `La plantilla dice que no usa el perfil, pero el bloque «${bloque.nombre}» usa {{${variable}}}.`,
        );
      }
    }
  }

  for (const variable of variablesDe(plantilla.mensaje)) {
    if (variable === 'hoy') continue;
    if (variable.startsWith('perfil')) {
      errores.push(
        `El mensaje usa {{${variable}}}: el perfil va en los bloques fijos, que se cachean.`,
      );
    } else if (!rutasDeEntrada.has(variable)) {
      errores.push(`El mensaje usa {{${variable}}}, que no existe en la entrada de la plantilla.`);
    }
  }

  const nombres = plantilla.bloquesFijos.map((b) => b.nombre);
  if (new Set(nombres).size !== nombres.length)
    errores.push('Hay dos bloques fijos con el mismo nombre.');
  if (plantilla.bloquesFijos.length === 0) errores.push('La plantilla no tiene bloques fijos.');
  return errores;
}

// ── Renderizado ──────────────────────────────────────────────────────────────

export class ErrorDePlantilla extends Error {
  readonly errores: readonly string[];
  constructor(mensaje: string, errores: readonly string[]) {
    super(`${mensaje}: ${errores.join(' · ')}`);
    this.name = 'ErrorDePlantilla';
    this.errores = errores;
  }
}

/**
 * Neutraliza las etiquetas con las que el mensaje separa los datos externos.
 *
 * Todo lo que viene de un prospecto, una web o un email es **dato, nunca
 * instrucción** (CLAUDE.md §1). El mensaje lo envuelve en `<dato_externo>`, y
 * un texto que cerrara esa etiqueta por su cuenta podría colar instrucciones
 * fuera de ella. Se rompe la etiqueta, no se borra el texto: el intento tiene
 * que seguir siendo visible para poder registrarlo.
 */
export function neutralizarEtiquetas(texto: string): string {
  return texto.replace(/<(\/?)\s*dato_externo/giu, '‹$1dato_externo');
}

function formatear(valor: unknown): string {
  if (valor === undefined || valor === null) return '(no consta)';
  if (typeof valor === 'string') return neutralizarEtiquetas(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (Array.isArray(valor)) {
    if (valor.length === 0) return '(ninguno)';
    return valor
      .map((item) =>
        typeof item === 'object' && item !== null
          ? `- ${Object.values(item as Record<string, unknown>)
              .filter((v) => v !== undefined)
              .map(formatear)
              .join(' — ')}`
          : `- ${formatear(item)}`,
      )
      .join('\n');
  }
  if (typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${formatear(v)}`)
      .join('\n');
  }
  return '(no consta)';
}

function resolver(datos: Record<string, unknown>, ruta: string): unknown {
  let actual: unknown = datos;
  for (const parte of ruta.split('.')) {
    if (typeof actual !== 'object' || actual === null) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

function sustituir(texto: string, datos: Record<string, unknown>): string {
  return texto.replace(VARIABLE, (_todo, ruta: string) => formatear(resolver(datos, ruta)));
}

/** Huella de una plantilla: cambia si cambia cualquier cosa que afecte a la salida. */
export function huellaDePlantilla(plantilla: Plantilla, extra = ''): string {
  const contenido = JSON.stringify({
    id: plantilla.id,
    version: plantilla.version,
    nivel: plantilla.nivel,
    maxTokens: plantilla.maxTokens,
    bloquesFijos: plantilla.bloquesFijos,
    mensaje: plantilla.mensaje,
    entrada: z.toJSONSchema(plantilla.esquemaEntrada),
    salida: z.toJSONSchema(plantilla.esquemaSalida),
    extra,
  });
  return createHash('sha256').update(contenido).digest('hex');
}

export interface DatosDeRenderizado {
  /** Obligatorio si la plantilla usa el perfil. */
  readonly perfil?: PerfilComercial;
  readonly entrada: unknown;
  /** Fecha de hoy, `AAAA-MM-DD`. Entra por parámetro para que los tests no dependan del reloj. */
  readonly hoy: string;
}

export function renderizar<E extends z.ZodType, T>(
  plantilla: Plantilla<E, T>,
  datos: DatosDeRenderizado,
): PromptRenderizado<T> {
  const errores = validarPlantilla(plantilla);
  if (errores.length > 0)
    throw new ErrorDePlantilla(`La plantilla ${plantilla.id} no es válida`, errores);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.hoy)) {
    throw new ErrorDePlantilla('Fecha de hoy inválida', [`«${datos.hoy}» no es AAAA-MM-DD`]);
  }

  let perfil: PerfilComercial | undefined;
  if (plantilla.usaPerfil) {
    const validado = esquemaPerfilComercial.safeParse(datos.perfil);
    if (!validado.success) {
      throw new ErrorDePlantilla(
        'El perfil comercial no es válido',
        validado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    perfil = validado.data;
  }

  const entrada = plantilla.esquemaEntrada.safeParse(datos.entrada);
  if (!entrada.success) {
    throw new ErrorDePlantilla(
      `La entrada de ${plantilla.id} no es válida`,
      entrada.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }

  const valores: Record<string, unknown> = { perfil, entrada: entrada.data, hoy: datos.hoy };
  const huella = huellaDePlantilla(plantilla);

  return {
    tarea: plantilla.tarea,
    nivel: plantilla.nivel,
    maxTokens: plantilla.maxTokens,
    bloquesFijos: plantilla.bloquesFijos.map(
      (b) => `## ${b.nombre}\n\n${sustituir(b.texto, valores).trim()}`,
    ),
    mensaje: sustituir(plantilla.mensaje, valores).trim(),
    esquema: plantilla.esquemaSalida,
    plantilla: { id: plantilla.id, version: `${String(plantilla.version)}.${huella.slice(0, 8)}` },
  };
}
