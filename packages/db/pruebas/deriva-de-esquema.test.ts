/**
 * Que el esquema Drizzle y la base no se separen.
 *
 * Hay dos descripciones del mismo esquema —las migraciones SQL, que son la
 * fuente de verdad, y `src/esquema`, con la que el panel consulta con tipos—, y
 * dos descripciones de lo mismo siempre acaban divergiendo. Este test aplica
 * las migraciones a un Postgres de verdad y las compara columna por columna.
 *
 * Sin esto, el síntoma de la deriva sería una consulta que compila y falla en
 * tiempo de ejecución en staging, que es el peor sitio donde enterarse.
 */

import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as esquema from '../src/esquema/index.ts';
import { cargarMigraciones } from '../src/migraciones.ts';
import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

let db: BaseDePruebas;

// El módulo exporta tablas, constantes y un `Record`. `is(valor, Table)` es la
// forma que da Drizzle de reconocer las suyas; el paso por `unknown[]` es para
// que el predicado de tipo encaje con la unión que TypeScript deduce del
// `Object.values` de un módulo.
const valoresDelEsquema: unknown[] = Object.values(esquema);
const tablasDrizzle = valoresDelEsquema.filter((valor): valor is PgTable => is(valor, Table));

beforeAll(async () => {
  db = await levantarBaseDePruebas();
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('esquema Drizzle contra la base', () => {
  it('describe todas las tablas que existen, y ninguna que no exista', async () => {
    const enLaBase = await db.crudo<{ tabla: string }>(
      `select c.relname as tabla
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );

    const nombresBase = enLaBase.map((f) => f.tabla).sort();
    const nombresDrizzle = tablasDrizzle.map((t) => getTableName(t)).sort();

    expect(nombresDrizzle).toEqual(nombresBase);
  });

  it('cada tabla tiene exactamente las mismas columnas en los dos sitios', async () => {
    const columnasBase = await db.crudo<{ tabla: string; columna: string }>(
      `select table_name as tabla, column_name as columna
       from information_schema.columns
       where table_schema = 'public'
       order by table_name, column_name`,
    );

    const porTabla = new Map<string, string[]>();
    for (const fila of columnasBase) {
      const lista = porTabla.get(fila.tabla) ?? [];
      lista.push(fila.columna);
      porTabla.set(fila.tabla, lista);
    }

    const diferencias: string[] = [];

    for (const tabla of tablasDrizzle) {
      const nombre = getTableName(tabla);
      const enDrizzle = Object.values(getTableColumns(tabla))
        .map((c) => c.name)
        .sort();
      const enBase = (porTabla.get(nombre) ?? []).slice().sort();

      for (const columna of enBase) {
        if (!enDrizzle.includes(columna)) {
          diferencias.push(`${nombre}.${columna} está en el SQL y no en src/esquema`);
        }
      }
      for (const columna of enDrizzle) {
        if (!enBase.includes(columna)) {
          diferencias.push(`${nombre}.${columna} está en src/esquema y no en el SQL`);
        }
      }
    }

    expect(diferencias).toEqual([]);
  });

  it('lo que el SQL declara `not null`, Drizzle también', async () => {
    const columnasBase = await db.crudo<{ tabla: string; columna: string; nula: string }>(
      `select table_name as tabla, column_name as columna, is_nullable as nula
       from information_schema.columns
       where table_schema = 'public'`,
    );

    const obligatorias = new Set(
      columnasBase.filter((c) => c.nula === 'NO').map((c) => `${c.tabla}.${c.columna}`),
    );

    const diferencias: string[] = [];
    for (const tabla of tablasDrizzle) {
      const nombre = getTableName(tabla);
      for (const columna of Object.values(getTableColumns(tabla))) {
        const clave = `${nombre}.${columna.name}`;
        const obligatoriaEnBase = obligatorias.has(clave);
        if (obligatoriaEnBase !== columna.notNull) {
          diferencias.push(
            `${clave}: en el SQL es ${obligatoriaEnBase ? 'not null' : 'nullable'} y en src/esquema ${columna.notNull ? 'not null' : 'nullable'}`,
          );
        }
      }
    }

    expect(diferencias).toEqual([]);
  });
});

describe('las migraciones son un historial, no un fichero editable', () => {
  it('se numeran sin huecos y sin repetir', () => {
    const numeros = cargarMigraciones().map((m) => Number(m.nombre.slice(0, 4)));
    expect(numeros).toEqual(numeros.map((_, i) => i + 1));
  });

  it('una migración aplicada que cambia de contenido aborta el arranque', async () => {
    const originales = cargarMigraciones();
    const manipulada = originales.map((m, i) => (i === 0 ? { ...m, sha256: 'a'.repeat(64) } : m));

    const ejecutor = {
      ejecutar: () => Promise.resolve(),
      consultar: <T>() =>
        Promise.resolve(
          originales.map((m) => ({
            nombre: m.nombre,
            sha256: m.sha256,
          })) as unknown as readonly T[],
        ),
    };

    const { aplicarMigraciones } = await import('../src/migraciones.ts');
    await expect(aplicarMigraciones(ejecutor, manipulada)).rejects.toThrow(
      /su contenido ha cambiado/,
    );
  });
});
