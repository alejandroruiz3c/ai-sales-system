/**
 * Un parámetro `jsonb` nunca se castea con `$n::jsonb` a secas.
 *
 * Este test existe por un fallo real y conviene contar el fallo, porque el test
 * no se entiende sin él.
 *
 * Con postgres.js, `insert … values ($1::jsonb)` y una cadena de JavaScript
 * hecha con `JSON.stringify` guarda en la columna **una cadena de JSON**, no un
 * objeto: el valor se codifica dos veces. No da ningún error. Se guarda, se
 * lee, y el fallo aparece dos pasos más allá, cuando algo intenta leer un campo
 * de dentro del objeto que no existe. En F1 el síntoma fue una pantalla del
 * panel en blanco con «Cannot read properties of undefined (reading 'desde')»,
 * que no menciona ni JSON ni la base de datos.
 *
 * La forma correcta es `$n::text::jsonb`, que le dice a Postgres que el
 * parámetro es texto y que lo parsee como JSON.
 *
 * Y esto es un test de repositorio y no un test de una función porque **el
 * fallo no se puede reproducir en las pruebas normales**: el Postgres embebido
 * de `packages/db/pruebas` usa su propio cliente, que serializa bien, así que
 * allí la forma corta funciona. Lo único que distingue las dos formas en todos
 * los entornos es leer el código.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

const RAIZ = join(import.meta.dirname, '..', '..');

/** `$1::jsonb` sin un `::text` delante. */
const FORMA_CORTA = /\$\d+::jsonb/g;

function ficherosDeCodigo(): readonly string[] {
  const salida = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return salida
    .split('\n')
    .filter((linea) => linea !== '')
    .filter((linea) => !linea.startsWith('scripts/src/parametros-jsonb'));
}

describe('parámetros jsonb', () => {
  it('nunca se pasan con $n::jsonb a secas', () => {
    const hallazgos: string[] = [];

    for (const relativa of ficherosDeCodigo()) {
      let contenido: string;
      try {
        contenido = readFileSync(join(RAIZ, relativa), 'utf8');
      } catch {
        continue;
      }

      const lineas = contenido.split('\n');
      lineas.forEach((linea, indice) => {
        for (const coincidencia of linea.matchAll(FORMA_CORTA)) {
          const antes = linea.slice(0, coincidencia.index);
          // `$1::text::jsonb` contiene `$1::text`, no `$1::jsonb`, así que la
          // expresión no lo encuentra. Esta comprobación cubre el caso raro de
          // que aparezcan las dos formas en la misma línea.
          if (antes.endsWith('::text')) continue;
          hallazgos.push(`${relativa}:${String(indice + 1)}  ${linea.trim()}`);
        }
      });
    }

    expect(
      hallazgos,
      [
        'Estos parámetros se castean con $n::jsonb a secas.',
        'Con postgres.js eso guarda una cadena de JSON en vez de un objeto, y no da error:',
        'el fallo aparece después, cuando alguien intenta leer un campo de dentro.',
        'Usa $n::text::jsonb.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('la expresión reconoce la forma mala y no la buena', () => {
    expect('values ($1::jsonb)'.match(FORMA_CORTA)).not.toBeNull();
    expect('values ($1::text::jsonb)'.replace('::text::jsonb', '::text::JSONB')).toContain(
      '::text',
    );
    // `$1::text::jsonb` no contiene la subcadena `$1::jsonb`.
    expect(/\$\d+::jsonb/.test('values ($1::text::jsonb)')).toBe(false);
  });

  it('corre desde la raíz del repositorio', () => {
    expect(RAIZ).toBe(process.cwd().replace(/\/scripts$/, ''));
  });
});
