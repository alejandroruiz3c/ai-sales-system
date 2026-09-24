/**
 * La conexión con Postgres, y las dos únicas formas de consultar.
 *
 * El aislamiento entre corporates lo aplica RLS dentro de la base (ADR 0003),
 * pero RLS solo actúa si la consulta llega con el rol y la identidad correctos.
 * Este módulo existe para que no haya forma de que llegue de otra manera:
 *
 *   · `conRLS(usuarioId, fn)` abre una transacción, se pone el rol
 *     `authenticated`, declara quién es el usuario y ejecuta lo que le pases.
 *     Todas las políticas se aplican. Es el camino de cualquier petición de
 *     usuario;
 *   · `comoSistema(motivo, fn)` usa `service_role`, que **salta RLS**. Exige un
 *     motivo por escrito, que se registra. Es para migraciones, secretos de
 *     Vault y trabajos de sistema, y nada más.
 *
 * **El manejador crudo de postgres.js no se exporta.** No es celo: es que el
 * agujero real de este diseño sería una consulta que no pasa por ninguno de los
 * dos envoltorios y acaba corriendo con el rol propietario, que no tiene
 * ninguna política que lo limite. Si no hay tercera puerta, no hay que
 * acordarse de cerrarla.
 *
 * Los dos envoltorios fijan el rol con `set_config(…, true)`, es decir **local
 * a la transacción**. Es obligatorio con el pooler de Supabase en modo
 * transacción: un `set role` de sesión se quedaría pegado a la conexión y la
 * siguiente petición, de otro usuario, la heredaría.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as esquema from './esquema/index.ts';

export interface ConfigBaseDeDatos {
  /** Cadena de conexión. Para el panel, la del pooler en modo transacción. */
  readonly url: string;
  /**
   * `true` si la URL apunta al pooler. Desactiva las sentencias preparadas,
   * que el modo transacción de Supavisor no admite.
   */
  readonly esPooler?: boolean;
  readonly maxConexiones?: number;
  /** Segundos de inactividad antes de cerrar una conexión. */
  readonly idleTimeout?: number;
  /** Dónde anotar cada uso de `service_role`. Sin él, no se anota. */
  readonly registrarUsoDeSistema?: (motivo: string) => void;
}

type ClienteDrizzle = ReturnType<typeof drizzle<typeof esquema>>;

/**
 * Lo que recibe el código que consulta, dentro de una transacción con el rol ya
 * fijado.
 *
 * Hay dos formas de consultar y las dos son de primera clase, a propósito:
 *
 *   · `orm` es Drizzle, para lo que se lee mejor con el constructor de
 *     consultas y se beneficia de los tipos de las tablas;
 *   · `consultar` es SQL parametrizado, para llamar a las funciones de `app` y
 *     para las consultas donde el SQL **es** la explicación. Un `join` con dos
 *     condiciones de pertenencia se entiende en SQL y se disfraza en cualquier
 *     otra notación, y en este sistema entender esas condiciones es el trabajo.
 *
 * Lo que no hay es una tercera forma que se salte el rol de la transacción.
 */
export interface Contexto {
  readonly orm: ClienteDrizzle;
  consultar<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  /** La primera fila, o `undefined`. Para las consultas que devuelven una. */
  unaFila<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
}

export interface BaseDeDatos {
  /** Consulta con las políticas RLS aplicadas, en nombre de un usuario. */
  conRLS<T>(usuarioId: string, fn: (ctx: Contexto) => Promise<T>): Promise<T>;
  /**
   * Consulta con `service_role`, que salta RLS. El motivo se registra y se
   * revisa en el PR: si no se puede explicar en una frase, no hace falta.
   */
  comoSistema<T>(motivo: string, fn: (ctx: Contexto) => Promise<T>): Promise<T>;
  /** Consulta sin sesión. No ve una sola fila; sirve para comprobaciones de vida. */
  conRolAnonimo<T>(fn: (ctx: Contexto) => Promise<T>): Promise<T>;
  cerrar(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearBaseDeDatos(config: ConfigBaseDeDatos): BaseDeDatos {
  const sql = postgres(config.url, {
    max: config.maxConexiones ?? 5,
    idle_timeout: config.idleTimeout ?? 20,
    // Sin sentencias preparadas salvo que se diga explícitamente que la URL
    // no es del pooler: el modo transacción de Supavisor no las admite, y
    // equivocarse en ese sentido rompe en producción, no en local.
    prepare: config.esPooler === false,
    // Un error de conexión no debe llevarse por delante el proceso entero.
    onnotice: () => undefined,
  });

  async function enTransaccion<T>(
    rol: 'authenticated' | 'service_role' | 'anon',
    claims: string | null,
    fn: (ctx: Contexto) => Promise<T>,
  ): Promise<T> {
    const resultado = await sql.begin(async (tx) => {
      await tx`select set_config('role', ${rol}, true)`;
      await tx`select set_config('request.jwt.claims', ${claims ?? ''}, true)`;

      /**
       * Drizzle sobre la transacción, construido solo si alguien lo pide.
       *
       * Dos cosas que no son evidentes y costaron un rato:
       *
       * 1. **El objeto de transacción de postgres.js no trae `options`**, y el
       *    controlador de Drizzle lee `client.options.parsers` al construirse.
       *    Sin el puente, cualquier transacción fallaba con «Cannot read
       *    properties of undefined (reading 'parsers')», que no menciona ni
       *    Drizzle ni la transacción.
       * 2. **Se construye perezosamente.** Construirlo en cada transacción
       *    hacía que el fallo de arriba tumbara también a quien solo quería
       *    `consultar`, que es la mayoría del panel.
       */
      let ormCacheado: ClienteDrizzle | undefined;

      const contexto: Contexto = {
        get orm() {
          const prototipo: object | null = Object.getPrototypeOf(tx) as object | null;
          const puente = Object.assign(Object.create(prototipo) as object, tx, {
            options: sql.options,
          });
          ormCacheado ??= drizzle(puente as unknown as postgres.Sql, { schema: esquema });
          return ormCacheado;
        },
        async consultar<F>(texto: string, params: readonly unknown[] = []) {
          const filas = await tx.unsafe(texto, params as never[]);
          return filas as unknown as readonly F[];
        },
        async unaFila<F>(texto: string, params: readonly unknown[] = []) {
          const filas = await tx.unsafe(texto, params as never[]);
          return (filas as unknown as readonly F[])[0];
        },
      };

      return fn(contexto);
    });
    return resultado as T;
  }

  return {
    async conRLS(usuarioId, fn) {
      if (!UUID.test(usuarioId)) {
        // Un identificador con otra forma no llega a la base: `auth.uid()`
        // devolvería null y todas las políticas dejarían de casar, así que el
        // síntoma sería «no hay datos» en vez de «el identificador está mal».
        throw new Error('El identificador de usuario no es un UUID');
      }
      const claims = JSON.stringify({ sub: usuarioId, role: 'authenticated' });
      return enTransaccion('authenticated', claims, fn);
    },

    async comoSistema(motivo, fn) {
      if (motivo.trim().length < 8) {
        throw new Error(
          'comoSistema() exige un motivo por escrito: service_role salta el aislamiento entre corporates (ADR 0003).',
        );
      }
      config.registrarUsoDeSistema?.(motivo);
      return enTransaccion('service_role', null, fn);
    },

    async conRolAnonimo(fn) {
      return enTransaccion('anon', null, fn);
    },

    async cerrar() {
      await sql.end({ timeout: 5 });
    },
  };
}
