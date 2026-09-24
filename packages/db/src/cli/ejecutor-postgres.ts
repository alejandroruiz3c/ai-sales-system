/**
 * Un `EjecutorSql` sobre postgres.js, para las herramientas de línea de órdenes.
 *
 * Aparte del cliente de `cliente.ts` a propósito: las migraciones necesitan el
 * rol propietario y la conexión directa (no el pooler), justo lo contrario de
 * lo que necesita el panel. Mezclar las dos cosas en un mismo cliente sería
 * dejar a mano, en el camino de una petición, la conexión que puede crear
 * tablas.
 */

import postgres from 'postgres';

import type { EjecutorSql } from '../migraciones.ts';

export interface EjecutorConCierre extends EjecutorSql {
  cerrar(): Promise<void>;
}

export function crearEjecutorPostgres(url: string): EjecutorConCierre {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });

  return {
    async ejecutar(texto) {
      // `.simple()` porque una migración son muchas sentencias en un solo
      // envío, con su `begin` y su `commit` dentro: así se aplica entera o no
      // se aplica.
      await sql.unsafe(texto).simple();
    },
    async consultar<T>(texto: string) {
      const filas = await sql.unsafe(texto);
      return filas as unknown as readonly T[];
    },
    async cerrar() {
      await sql.end({ timeout: 5 });
    },
  };
}
