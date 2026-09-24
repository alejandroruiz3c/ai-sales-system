/**
 * F0.19 · `pnpm sistema-vacio`
 *
 * Recorre los ficheros del repositorio (los versionados y los nuevos que no
 * estén ignorados) y falla si encuentra un dato de negocio real. Además falla si
 * un fichero de claves (`KEYS.*`, `.env`, un `.pem`) ha llegado a estar
 * versionado. La lógica está en `sistema-vacio.ts`, que es la que tiene tests;
 * aquí solo está la entrada y la salida.
 *
 * Uso:
 *   node scripts/src/sistema-vacio-cli.ts
 *   node scripts/src/sistema-vacio-cli.ts --ruta docs      # solo una subcarpeta
 *   node scripts/src/sistema-vacio-cli.ts --json           # salida para máquinas
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import {
  analizar,
  cargarLista,
  comprobarFicherosDeClaves,
  comprobarReferenciasAClaves,
  formatearInforme,
  type Fichero,
} from './sistema-vacio.ts';

/**
 * La comprobación se apoya en git para saber qué ficheros mirar. Si no hay
 * repositorio, falla con un mensaje que se entiende, no con un error de
 * `execFileSync`: esto corre dentro del build de Vercel, y un fallo opaco ahí
 * cuesta media hora de logs.
 */
function raizDelRepositorio(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      'No hay repositorio de git aquí, y la comprobación de sistema vacío lo necesita ' +
        'para saber qué ficheros mirar y cuáles están versionados.\n' +
        '  · En local: ejecútalo desde dentro del repositorio.\n' +
        '  · En el build de Vercel: comprueba que .vercelignore no excluye .git.',
    );
  }
}

/**
 * Versionados (`-c`) más nuevos sin versionar (`-o`), respetando `.gitignore`
 * (`--exclude-standard`). Lo segundo importa: un fixture recién creado y sin
 * `git add` tiene que fallar igual, o el check se salta solo.
 */
function ficherosDelRepositorio(raiz: string, subruta: string | undefined): string[] {
  return listar(raiz, ['ls-files', '-co', '--exclude-standard', '-z'], subruta);
}

/**
 * Solo los versionados (`-c`), para la comprobación de ficheros de claves.
 *
 * Aquí no vale incluir los no versionados: `KEYS.rtf` existe en la carpeta del
 * proyecto y eso es correcto. Lo que se persigue es que esté en el índice de
 * git, que es cuando deja de ser un fichero local y pasa a ser un secreto
 * publicado.
 */
function ficherosVersionados(raiz: string, subruta: string | undefined): string[] {
  return listar(raiz, ['ls-files', '-c', '-z'], subruta);
}

function listar(raiz: string, argumentos: string[], subruta: string | undefined): string[] {
  const completos = subruta === undefined ? argumentos : [...argumentos, '--', subruta];
  const salida = execFileSync('git', completos, { cwd: raiz, encoding: 'utf8' });
  return [...new Set(salida.split('\0').filter((ruta) => ruta.length > 0))].sort();
}

function leer(raiz: string, ruta: string): Fichero | undefined {
  const absoluta = join(raiz, ruta);
  try {
    if (!statSync(absoluta).isFile()) return undefined;
    return { ruta, contenido: readFileSync(absoluta, 'utf8') };
  } catch {
    // Un enlace roto o un fichero borrado entre el listado y la lectura no es
    // un dato de negocio: se ignora en silencio.
    return undefined;
  }
}

/**
 * Los ajustes de Claude Code de esta máquina, si existen.
 *
 * No están versionados —git los ignora— y aun así hay que mirarlos: la lista de
 * permisos preaprobados puede contener un comando que lea el fichero de claves,
 * y un permiso preaprobado es peor que un script, porque el comando se ejecuta
 * sin preguntar. El 2026-09-24, el día del fallo, ahí estaba exactamente el
 * comando que lo provocó.
 *
 * Si no existen, no pasa nada: en el build de Vercel no hay ninguno.
 */
function ajustesDeClaude(raiz: string): Fichero[] {
  const candidatos = ['.claude/settings.local.json', '.claude/settings.json'];
  return candidatos
    .map((ruta) => leer(raiz, ruta))
    .filter((fichero): fichero is Fichero => fichero !== undefined);
}

function argumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  if (indice === -1) return undefined;
  return process.argv[indice + 1];
}

function principal(): void {
  const raiz = raizDelRepositorio();
  const lista = cargarLista(
    JSON.parse(readFileSync(join(raiz, 'scripts/terminos-vetados.json'), 'utf8')),
  );

  const rutas = ficherosDelRepositorio(raiz, argumento('--ruta'));
  const ficheros = rutas
    .map((ruta) => leer(raiz, ruta))
    .filter((fichero): fichero is Fichero => fichero !== undefined);

  const hallazgos = [
    ...comprobarFicherosDeClaves(ficherosVersionados(raiz, argumento('--ruta'))),
    ...comprobarReferenciasAClaves([...ficheros, ...ajustesDeClaude(raiz)]),
    ...analizar(ficheros, lista),
  ];

  if (process.argv.includes('--json')) {
    process.stdout.write(
      `${JSON.stringify({ ficherosAnalizados: ficheros.length, hallazgos }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(formatearInforme(hallazgos, ficheros.length));
  }

  process.exitCode = hallazgos.length === 0 ? 0 : 1;
}

principal();
