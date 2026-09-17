/**
 * F0.19 · `pnpm sistema-vacio`
 *
 * Recorre los ficheros del repositorio (los versionados y los nuevos que no
 * estén ignorados) y falla si encuentra un dato de negocio real. La lógica está
 * en `sistema-vacio.ts`, que es la que tiene tests; aquí solo está la entrada y
 * la salida.
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

import { analizar, cargarLista, formatearInforme, type Fichero } from './sistema-vacio.ts';

function raizDelRepositorio(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/**
 * Versionados (`-c`) más nuevos sin versionar (`-o`), respetando `.gitignore`
 * (`--exclude-standard`). Lo segundo importa: un fixture recién creado y sin
 * `git add` tiene que fallar igual, o el check se salta solo.
 */
function ficherosDelRepositorio(raiz: string, subruta: string | undefined): string[] {
  const argumentos = ['ls-files', '-co', '--exclude-standard', '-z'];
  if (subruta !== undefined) argumentos.push('--', subruta);
  const salida = execFileSync('git', argumentos, { cwd: raiz, encoding: 'utf8' });
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

  const hallazgos = analizar(ficheros, lista);

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
