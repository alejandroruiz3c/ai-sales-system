/**
 * Carga y aplicación de las migraciones SQL.
 *
 * Las migraciones son **SQL escrito a mano**, no SQL generado. Es una decisión
 * y tiene motivo: la política RLS de cada tabla va en la misma migración que la
 * tabla (ADR 0003), y un generador de esquema no genera políticas. Drizzle se
 * usa para consultar con tipos, y hay un test que compara su esquema con la
 * base real para que las dos descripciones no se separen.
 *
 * Este módulo lee ficheros del disco, así que **solo se usa desde la CLI y
 * desde los tests**, nunca desde el panel: en una función de Vercel el disco no
 * contiene la carpeta de migraciones.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Una migración, con su huella para detectar que alguien la editó después. */
export interface Migracion {
  readonly nombre: string;
  readonly sha256: string;
  readonly contenido: string;
}

/** Lo que hace falta para hablar con una base: ejecutar SQL de varias sentencias. */
export interface EjecutorSql {
  ejecutar(sql: string): Promise<void>;
  consultar<T>(sql: string): Promise<readonly T[]>;
}

export const CARPETA_MIGRACIONES = join(import.meta.dirname, '..', 'migraciones');

const NOMBRE_VALIDO = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Las migraciones en el orden en que se aplican, que es el de su número. */
export function cargarMigraciones(carpeta = CARPETA_MIGRACIONES): readonly Migracion[] {
  const ficheros = readdirSync(carpeta)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return ficheros.map((nombre) => {
    if (!NOMBRE_VALIDO.test(nombre)) {
      throw new Error(
        `"${nombre}" no sigue el formato NNNN_nombre_en_minusculas.sql. El número fija el orden de aplicación y no es decorativo.`,
      );
    }
    const contenido = readFileSync(join(carpeta, nombre), 'utf8');
    return { nombre, sha256: createHash('sha256').update(contenido).digest('hex'), contenido };
  });
}

interface FilaAplicada {
  nombre: string;
  sha256: string;
}

/**
 * Qué migraciones están ya aplicadas.
 *
 * En una base virgen la tabla de registro todavía no existe, porque la crea la
 * primera migración. Eso no es un error: es el primer arranque.
 */
async function yaAplicadas(ejecutor: EjecutorSql): Promise<Map<string, string>> {
  try {
    const filas = await ejecutor.consultar<FilaAplicada>(
      'select nombre, sha256 from app.migraciones',
    );
    return new Map(filas.map((f) => [f.nombre, f.sha256]));
  } catch {
    return new Map();
  }
}

export interface ResultadoMigracion {
  readonly aplicadas: readonly string[];
  readonly yaEstaban: readonly string[];
}

/**
 * Aplica las migraciones que falten, en orden, cada una en su transacción.
 *
 * Si una migración ya aplicada tiene un contenido distinto del registrado,
 * aborta. Editar una migración que ya corrió en staging significa que staging y
 * el repositorio describen bases distintas, y de los dos sitios el que miente
 * no se puede saber desde aquí.
 */
export async function aplicarMigraciones(
  ejecutor: EjecutorSql,
  migraciones: readonly Migracion[] = cargarMigraciones(),
): Promise<ResultadoMigracion> {
  const registradas = await yaAplicadas(ejecutor);
  const aplicadas: string[] = [];
  const yaEstaban: string[] = [];

  for (const migracion of migraciones) {
    const huella = registradas.get(migracion.nombre);

    if (huella !== undefined) {
      if (huella !== migracion.sha256) {
        throw new Error(
          [
            `La migración "${migracion.nombre}" ya está aplicada, pero su contenido ha cambiado.`,
            'Una migración aplicada no se edita: se escribe otra encima. Si no, la base y el repositorio dejan de describir lo mismo.',
          ].join('\n'),
        );
      }
      yaEstaban.push(migracion.nombre);
      continue;
    }

    // El nombre y la huella vienen validados (`NOMBRE_VALIDO` y un sha256 en
    // hexadecimal), así que se pueden interpolar sin abrir una inyección.
    await ejecutor.ejecutar(
      [
        'begin;',
        migracion.contenido,
        `insert into app.migraciones (nombre, sha256) values ('${migracion.nombre}', '${migracion.sha256}');`,
        'commit;',
      ].join('\n'),
    );
    aplicadas.push(migracion.nombre);
  }

  return { aplicadas, yaEstaban };
}
