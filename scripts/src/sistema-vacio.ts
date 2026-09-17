/**
 * F0.19 · Comprobación "el sistema nace vacío".
 *
 * SALES OS no contiene ningún dato de negocio real: ni un corporate, ni un
 * producto, ni un precio, ni un ICP, ni un argumentario (plan §0, regla
 * permanente 3 de `CLAUDE.md`). Este módulo es la lógica pura de esa
 * comprobación; `sistema-vacio-cli.ts` la ejecuta sobre los ficheros del
 * repositorio y CI la exige en cada PR.
 *
 * Dos comprobaciones, porque son dos agujeros distintos:
 *
 * 1. **Términos vetados.** Nombres, productos y precios reales concretos que
 *    ya estuvieron en el repositorio o que salen del sistema antiguo. Es una
 *    lista cerrada: detecta la reincidencia, no la creatividad.
 * 2. **Datos de prueba sin marcar.** Un fixture, una semilla o un fichero de
 *    evals que habla de precios, ICP u ofertas tiene que declarar por escrito
 *    que su corporate es inventado. Esto sí detecta lo nuevo, porque el camino
 *    por el que un dato real entraría es "lo pongo como fixture, que es un test".
 *
 * La lista de términos es dato, no código: vive en `scripts/terminos-vetados.json`.
 */

import { z } from 'zod';

/** Una expresión regular que no compila en la lista es un fallo de configuración. */
const patronValido = z
  .string()
  .min(1)
  .refine(
    (patron) => {
      try {
        new RegExp(patron, 'u');
        return true;
      } catch {
        return false;
      }
    },
    { message: 'no es una expresión regular válida' },
  );

const esquemaRegla = z.object({
  id: z.string().min(1),
  patron: patronValido,
  motivo: z.string().min(1),
});

const esquemaExcepcion = z.object({
  id: z.string().min(1),
  patron: patronValido,
  motivo: z.string().min(1),
});

const esquemaDatosDePrueba = z.object({
  carpetas: z.array(z.string().min(1)),
  senales: z.array(patronValido),
  marcador: z.string().min(1),
});

export const esquemaListaVetada = z.object({
  descripcion: z.string().min(1),
  rutasExcluidas: z.array(z.string().min(1)),
  extensionesExcluidas: z.array(z.string().min(1)),
  excepciones: z.array(esquemaExcepcion),
  reglas: z.array(esquemaRegla).min(1),
  datosDePrueba: esquemaDatosDePrueba,
});

export type ListaVetada = z.output<typeof esquemaListaVetada>;
export type Regla = z.output<typeof esquemaRegla>;
export type Excepcion = z.output<typeof esquemaExcepcion>;

export interface Hallazgo {
  /** Ruta relativa a la raíz del repositorio. */
  readonly ruta: string;
  /** Línea 1-indexada, como la espera un editor y como la imprime CI. */
  readonly linea: number;
  /** Qué regla ha saltado. */
  readonly regla: string;
  /** Por qué existe esa regla. Lo lee quien ve fallar el check. */
  readonly motivo: string;
  /** El texto exacto encontrado, para poder buscarlo. */
  readonly extracto: string;
}

export interface Fichero {
  readonly ruta: string;
  readonly contenido: string;
}

const CARACTERES_A_ESCAPAR = /[.+^${}()|[\]\\?]/g;

/**
 * Convierte un glob sencillo en expresión regular. Soporta `*` (dentro de un
 * segmento de ruta) y `**` (cualquier número de segmentos), que es todo lo que
 * necesitan las rutas de este repositorio.
 */
export function globARegex(glob: string): RegExp {
  let patron = '';
  let i = 0;
  while (i < glob.length) {
    const caracter = glob.charAt(i);
    if (caracter === '*' && glob.charAt(i + 1) === '*' && glob.charAt(i + 2) === '/') {
      patron += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (caracter === '*' && glob.charAt(i + 1) === '*') {
      patron += '.*';
      i += 2;
      continue;
    }
    if (caracter === '*') {
      patron += '[^/]*';
      i += 1;
      continue;
    }
    patron += caracter.replace(CARACTERES_A_ESCAPAR, '\\$&');
    i += 1;
  }
  return new RegExp(`^${patron}$`);
}

export function rutaExcluida(ruta: string, patrones: readonly string[]): boolean {
  return patrones.some((patron) => globARegex(patron).test(ruta));
}

export function extensionExcluida(ruta: string, extensiones: readonly string[]): boolean {
  const minuscula = ruta.toLowerCase();
  return extensiones.some((extension) => minuscula.endsWith(extension.toLowerCase()));
}

/**
 * Sustituye por espacios todo lo que una excepción declara legítimo, antes de
 * buscar términos vetados.
 *
 * Se sustituye por espacios en vez de recortar para que las líneas sigan
 * cuadrando con el fichero original: un hallazgo tiene que apuntar a la línea
 * de verdad.
 */
export function neutralizarExcepciones(
  contenido: string,
  excepciones: readonly Excepcion[],
): string {
  let resultado = contenido;
  for (const excepcion of excepciones) {
    const expresion = new RegExp(excepcion.patron, 'giu');
    resultado = resultado.replace(expresion, (coincidencia) => coincidencia.replace(/[^\n]/g, ' '));
  }
  return resultado;
}

function lineaDe(contenido: string, indice: number): number {
  let linea = 1;
  for (let i = 0; i < indice; i += 1) {
    if (contenido.charAt(i) === '\n') linea += 1;
  }
  return linea;
}

/** Busca los términos vetados en un texto ya neutralizado. */
export function buscarTerminos(
  ruta: string,
  contenido: string,
  reglas: readonly Regla[],
): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const regla of reglas) {
    const expresion = new RegExp(regla.patron, 'giu');
    for (const coincidencia of contenido.matchAll(expresion)) {
      hallazgos.push({
        ruta,
        linea: lineaDe(contenido, coincidencia.index),
        regla: regla.id,
        motivo: regla.motivo,
        extracto: coincidencia[0].trim(),
      });
    }
  }
  return hallazgos;
}

/**
 * Un fichero de datos de prueba que habla de dinero, ICP u ofertas tiene que
 * decir que su corporate es inventado. Si no lo dice, nadie puede saber si el
 * precio que contiene es de verdad.
 */
export function comprobarDatosDePrueba(
  ruta: string,
  contenido: string,
  configuracion: ListaVetada['datosDePrueba'],
): Hallazgo[] {
  if (!rutaExcluida(ruta, configuracion.carpetas)) return [];
  if (contenido.includes(configuracion.marcador)) return [];

  for (const senal of configuracion.senales) {
    const coincidencia = new RegExp(senal, 'giu').exec(contenido);
    if (coincidencia) {
      return [
        {
          ruta,
          linea: lineaDe(contenido, coincidencia.index),
          regla: 'datos-de-prueba-sin-marcar',
          motivo:
            'Es un fichero de datos de prueba que habla de datos comerciales y no declara ' +
            `«${configuracion.marcador}». Si el corporate es inventado, dilo en el fichero; ` +
            'si es real, no puede estar en el repositorio.',
          extracto: coincidencia[0].trim(),
        },
      ];
    }
  }
  return [];
}

/** Analiza un fichero completo. Devuelve los hallazgos en orden de aparición. */
export function analizarFichero(fichero: Fichero, lista: ListaVetada): Hallazgo[] {
  if (rutaExcluida(fichero.ruta, lista.rutasExcluidas)) return [];
  if (extensionExcluida(fichero.ruta, lista.extensionesExcluidas)) return [];

  const neutralizado = neutralizarExcepciones(fichero.contenido, lista.excepciones);
  return [
    ...buscarTerminos(fichero.ruta, neutralizado, lista.reglas),
    ...comprobarDatosDePrueba(fichero.ruta, fichero.contenido, lista.datosDePrueba),
  ].sort((a, b) => a.linea - b.linea);
}

/** Analiza el repositorio entero. */
export function analizar(ficheros: readonly Fichero[], lista: ListaVetada): Hallazgo[] {
  return ficheros.flatMap((fichero) => analizarFichero(fichero, lista));
}

/** Valida la lista de términos vetados. Lo que no valida, no entra. */
export function cargarLista(datos: unknown): ListaVetada {
  return esquemaListaVetada.parse(datos);
}

/** Informe legible para la consola y para el log de CI. */
export function formatearInforme(
  hallazgos: readonly Hallazgo[],
  ficherosAnalizados: number,
): string {
  if (hallazgos.length === 0) {
    return `✔ El sistema nace vacío: ${String(ficherosAnalizados)} ficheros analizados, ningún dato de negocio real.\n`;
  }

  const porFichero = new Map<string, Hallazgo[]>();
  for (const hallazgo of hallazgos) {
    const previos = porFichero.get(hallazgo.ruta) ?? [];
    previos.push(hallazgo);
    porFichero.set(hallazgo.ruta, previos);
  }

  const lineas: string[] = [
    `✖ Hay datos de negocio real en el repositorio: ${String(hallazgos.length)} hallazgo(s) en ${String(porFichero.size)} fichero(s).`,
    '',
    '  SALES OS nace vacío (plan §0, regla permanente 3 de CLAUDE.md). Todo el',
    '  conocimiento comercial entra por el onboarding de cada corporate y vive en',
    '  la base de datos de su tenant, nunca en el código ni en las plantillas.',
    '',
  ];

  for (const [ruta, suyos] of porFichero) {
    lineas.push(`  ${ruta}`);
    for (const hallazgo of suyos) {
      lineas.push(
        `    ${ruta}:${String(hallazgo.linea)}  «${hallazgo.extracto}»  [${hallazgo.regla}]`,
      );
      lineas.push(`      ${hallazgo.motivo}`);
    }
    lineas.push('');
  }

  lineas.push(
    '  Si crees que un hallazgo es legítimo, no lo silencies en el código: añade la',
    '  excepción con su motivo en scripts/terminos-vetados.json, que se revisa en el PR.',
    '',
  );
  return lineas.join('\n');
}
