/**
 * F0.19 · Comprobación "el sistema nace vacío".
 *
 * SALES OS no contiene ningún dato de negocio real: ni un corporate, ni un
 * producto, ni un precio, ni un ICP, ni un argumentario (plan §0, regla
 * permanente 3 de `CLAUDE.md`). Este módulo es la lógica pura de esa
 * comprobación; `sistema-vacio-cli.ts` la ejecuta sobre los ficheros del
 * repositorio y CI la exige en cada PR.
 *
 * Tres comprobaciones, porque son tres agujeros distintos:
 *
 * 1. **Términos vetados.** Nombres, productos y precios reales concretos que
 *    ya estuvieron en el repositorio o que salen del sistema antiguo. Es una
 *    lista cerrada: detecta la reincidencia, no la creatividad.
 * 2. **Datos de prueba sin marcar.** Un fixture, una semilla o un fichero de
 *    evals que habla de precios, ICP u ofertas tiene que declarar por escrito
 *    que su corporate es inventado. Esto sí detecta lo nuevo, porque el camino
 *    por el que un dato real entraría es "lo pongo como fixture, que es un test".
 * 3. **Ficheros de claves versionados.** `KEYS.*`, `.env` y compañía no pueden
 *    estar en git. No es un dato de negocio, pero es el mismo agujero: algo que
 *    no debería salir de la máquina de Alex y que, si entra en el historial, ya
 *    no se puede sacar.
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

/**
 * Ficheros que no pueden estar versionados nunca, pase lo que pase.
 *
 * `KEYS.rtf` vive en la carpeta del proyecto por decisión de Alex (2026-09-18,
 * regla permanente 4 de `CLAUDE.md`): es cómodo tenerlo a mano y `.gitignore` lo
 * excluye. Pero `.gitignore` solo protege mientras nadie haga `git add -f`, y un
 * fichero de claves versionado no se arregla borrándolo: queda en el historial
 * para siempre y hay que rotar todas las claves.
 *
 * De ahí que esto sea una comprobación de CI y no una nota en un README.
 */
export const PATRONES_DE_CLAVES: readonly string[] = [
  'KEYS',
  'KEYS.*',
  '**/KEYS',
  '**/KEYS.*',
  'claves',
  'claves.*',
  '**/claves.*',
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
];

/** `.env.example` sí se versiona: documenta las variables y no lleva valores. */
export const EXCEPCIONES_DE_CLAVES: readonly string[] = ['.env.example', '**/.env.example'];

/**
 * Falla si un fichero de claves ha llegado a estar versionado.
 *
 * Recibe **solo las rutas versionadas** (`git ls-files`), no las del disco: que
 * `KEYS.rtf` exista en la carpeta es correcto; lo que no puede es estar en git.
 */
export const CLAVES_VERSIONADAS = 'fichero-de-claves-versionado';

export function comprobarFicherosDeClaves(rutasVersionadas: readonly string[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const ruta of rutasVersionadas) {
    if (rutaExcluida(ruta, EXCEPCIONES_DE_CLAVES)) continue;
    if (!rutaExcluida(ruta, PATRONES_DE_CLAVES)) continue;
    hallazgos.push({
      ruta,
      linea: 1,
      regla: CLAVES_VERSIONADAS,
      motivo:
        'Es un fichero de claves y está versionado en git. Sácalo del índice con ' +
        `«git rm --cached ${ruta}», comprueba que .gitignore lo excluye y, si ya se ha ` +
        'subido en algún commit, considera comprometidas todas las claves que contenga y ' +
        'rótalas: borrarlo en un commit nuevo no lo saca del historial.',
      extracto: ruta,
    });
  }
  return hallazgos;
}

/**
 * Ningún script del repositorio referencia `KEYS.*` (regla permanente 4).
 *
 * Esta comprobación existe por un fallo concreto, y conviene contarlo porque la
 * comprobación no se entiende sin él. El 2026-09-24, intentando listar **solo
 * los nombres** de las claves de `KEYS.rtf`, un filtro de texto que parecía
 * seguro imprimió cuatro valores enteros. El fallo no fue de atención: fue que
 * la regla anterior permitía leer el fichero y confiaba en acertar al decidir
 * qué enseñar. Cualquier procedimiento que decida eso puede equivocarse.
 *
 * Así que la regla nueva no es «ten cuidado al leerlo», es «no lo leas», y esto
 * la hace mecánica: si un script lo nombra, `pnpm verify` se cae.
 *
 * Tres detalles del alcance, cada uno con su motivo:
 *
 * 1. **Solo mira código, no documentación.** `CLAUDE.md` tiene que poder
 *    enunciar la regla, y este informe de entrega tiene que poder contar el
 *    fallo. Lo que no puede existir es un `.sh`, un `.mjs`, un `package.json` o
 *    un hook que lo nombre, porque eso es un camino ejecutable hacia el
 *    fichero.
 * 2. **Mira también los permisos preaprobados de `.claude/`**, aunque no estén
 *    versionados. Un permiso preaprobado es peor que un script: convierte el
 *    comando prohibido en uno que se ejecuta sin preguntar. El día del fallo,
 *    `Bash(textutil -convert txt -stdout KEYS.rtf)` estaba en esa lista.
 * 3. **Se excluyen los ficheros de esta propia comprobación**, que necesitan
 *    escribir el patrón para poder buscarlo. Es el mismo trato que ya tiene
 *    `scripts/terminos-vetados.json`.
 */
export const SCRIPT_LEE_CLAVES = 'script-que-referencia-el-fichero-de-claves';

/** Qué se considera código a efectos de esta comprobación. */
export const RUTAS_DE_CODIGO: readonly string[] = [
  '**/*.sh',
  '**/*.bash',
  '**/*.zsh',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.js',
  '**/*.ts',
  '**/*.tsx',
  '**/*.json',
  '**/*.yml',
  '**/*.yaml',
  '.husky/**',
];

/** Los ficheros que tienen que poder nombrar el patrón para poder buscarlo. */
export const EXCEPCIONES_DE_REFERENCIA: readonly string[] = [
  'scripts/src/sistema-vacio.ts',
  'scripts/src/sistema-vacio.test.ts',
  'scripts/src/sistema-vacio-cli.ts',
  'scripts/terminos-vetados.json',
];

/**
 * `KEYS` como nombre de fichero, no como parte de otra palabra.
 *
 * El límite por delante y por detrás evita que `SUPABASE_KEYS` o `API_KEYS_URL`
 * disparen la comprobación: lo que se busca es el fichero, no cualquier
 * identificador que contenga esas cinco letras.
 */
const REFERENCIA_A_CLAVES = /(?<![A-Za-z0-9_-])KEYS(\.[A-Za-z0-9*]+)?(?![A-Za-z0-9_])/g;

export function comprobarReferenciasAClaves(ficheros: readonly Fichero[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const fichero of ficheros) {
    if (!rutaExcluida(fichero.ruta, RUTAS_DE_CODIGO)) continue;
    if (rutaExcluida(fichero.ruta, EXCEPCIONES_DE_REFERENCIA)) continue;

    for (const coincidencia of fichero.contenido.matchAll(REFERENCIA_A_CLAVES)) {
      hallazgos.push({
        ruta: fichero.ruta,
        linea: lineaDe(fichero.contenido, coincidencia.index),
        regla: SCRIPT_LEE_CLAVES,
        motivo:
          'Un script del repositorio nombra el fichero de claves. Ningún comando ni script ' +
          'puede leer, filtrar, transformar ni listar el contenido de KEYS.* (regla permanente 4 ' +
          'de CLAUDE.md), tampoco para mostrar «solo los nombres»: el 2026-09-24 un filtro que ' +
          'parecía seguro imprimió cuatro valores enteros. Si hace falta saber qué claves ' +
          'existen, se le pregunta a Alex. Si el script solo lo menciona en un mensaje, ' +
          'reescribe el mensaje sin nombrar el fichero.',
        extracto: coincidencia[0],
      });
    }
  }

  return hallazgos;
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

  const hayClaves = hallazgos.some((hallazgo) => hallazgo.regla === CLAVES_VERSIONADAS);
  const hayReferencias = hallazgos.some((hallazgo) => hallazgo.regla === SCRIPT_LEE_CLAVES);
  const hayNegocio = hallazgos.some(
    (hallazgo) => hallazgo.regla !== CLAVES_VERSIONADAS && hallazgo.regla !== SCRIPT_LEE_CLAVES,
  );

  // El encabezado dice qué ha fallado de verdad. Un fichero de claves y un
  // precio real son dos problemas distintos y se arreglan de forma distinta:
  // decir "hay datos de negocio" cuando lo que hay es un .env manda a quien lee
  // el log a buscar lo que no es.
  const lineas: string[] = [
    `✖ La comprobación de sistema vacío ha fallado: ${String(hallazgos.length)} hallazgo(s) en ${String(porFichero.size)} fichero(s).`,
    '',
  ];

  if (hayClaves) {
    lineas.push(
      '  Hay un fichero de claves versionado. Sácalo del índice de git y da por',
      '  comprometidas sus claves si ya se subió: el historial no se limpia con un',
      '  commit de borrado (regla permanente 4 de CLAUDE.md).',
      '',
    );
  }

  if (hayReferencias) {
    lineas.push(
      '  Hay un script que nombra el fichero de claves. Ningún comando ni script puede',
      '  leerlo, filtrarlo, transformarlo ni listarlo, tampoco para mostrar «solo los',
      '  nombres» (regla permanente 4 de CLAUDE.md). Si solo lo menciona en un mensaje,',
      '  reescribe el mensaje sin nombrarlo; si hace falta saber qué claves existen, se',
      '  le pregunta a Alex.',
      '',
    );
  }

  if (hayNegocio) {
    lineas.push(
      '  Hay datos de negocio real en el repositorio. SALES OS nace vacío (plan §0,',
      '  regla permanente 3 de CLAUDE.md): todo el conocimiento comercial entra por el',
      '  onboarding de cada corporate y vive en la base de datos de su tenant, nunca en',
      '  el código ni en las plantillas.',
      '',
    );
  }

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

  if (hayNegocio) {
    lineas.push(
      '  Si crees que un hallazgo es legítimo, no lo silencies en el código: añade la',
      '  excepción con su motivo en scripts/terminos-vetados.json, que se revisa en el PR.',
      '',
    );
  }
  return lineas.join('\n');
}
