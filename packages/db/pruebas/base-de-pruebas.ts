/**
 * Postgres de verdad, embebido, para las pruebas de aislamiento.
 *
 * PGlite es Postgres compilado a WebAssembly: mismas políticas RLS, mismos
 * roles, mismos triggers. No es un simulacro de base de datos, y eso importa
 * porque lo que hay que demostrar aquí es un comportamiento de la base, no del
 * código que la llama.
 *
 * Corre sin Docker, que es el requisito que lo hace posible: estas pruebas
 * están dentro de `pnpm verify`, y `pnpm verify` corre dentro del build de
 * Vercel. Un test de fuga entre tenants que solo se pueda ejecutar a mano no
 * protege nada.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { aplicarMigraciones, type EjecutorSql } from '../src/migraciones.ts';

const SHIM = join(import.meta.dirname, 'shim-supabase.sql');

export interface BaseDePruebas {
  /** SQL crudo, como propietario. Para preparar el escenario. */
  crudo<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<readonly T[]>;
  /** SQL con el rol `authenticated` y la identidad de un usuario. */
  comoUsuario<T = Record<string, unknown>>(
    usuarioId: string,
    sql: string,
    params?: unknown[],
  ): Promise<readonly T[]>;
  /** SQL con el rol `anon`: sin sesión. */
  comoAnonimo<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<readonly T[]>;
  /** SQL con el rol `service_role`, que salta RLS. El camino de sistema. */
  comoSistema<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<readonly T[]>;
  /** Crea un usuario en `auth.users` y devuelve su id. */
  crearUsuario(email: string, nombre?: string): Promise<string>;
  /** Crea un tenant con un propietario y devuelve su id. */
  crearTenant(
    propietarioId: string,
    nombre: string,
    slug: string,
    presupuesto?: number,
  ): Promise<string>;
  /** Añade a alguien a un tenant con un rol. */
  anadirMiembro(tenantId: string, usuarioId: string, rol: string): Promise<void>;
  /**
   * Siembra una fila en **todas** las tablas de tenant, y devuelve los nombres
   * de las tablas que ha tocado.
   *
   * El test de fuga compara esa lista con las tablas que hay de verdad en la
   * base: si alguien añade una tabla y no la siembra aquí, el test falla en vez
   * de pasar sin comprobar nada. Una tabla sin fila sembrada haría que
   * «no se ven filas del otro tenant» fuera cierto por vacío.
   */
  sembrarTodasLasTablas(tenantId: string): Promise<readonly string[]>;
  /** Tablas base de `public` que llevan `tenant_id`. */
  tablasDeTenant(): Promise<readonly string[]>;
  cerrar(): Promise<void>;
}

export async function levantarBaseDePruebas(): Promise<BaseDePruebas> {
  const pg = new PGlite();
  await pg.waitReady;

  const ejecutor: EjecutorSql = {
    async ejecutar(sql) {
      await pg.exec(sql);
    },
    async consultar<T>(sql: string) {
      const resultado = await pg.query<T>(sql);
      return resultado.rows;
    },
  };

  await pg.exec(readFileSync(SHIM, 'utf8'));
  await aplicarMigraciones(ejecutor);

  async function crudo<T>(sql: string, params: unknown[] = []): Promise<readonly T[]> {
    const resultado = await pg.query<T>(sql, params);
    return resultado.rows;
  }

  /**
   * Cada consulta «como usuario» va en su propia transacción con el rol y los
   * claims fijados de forma local, que es exactamente lo que hace `conRLS` en
   * producción. Si se fijaran de sesión, la consulta siguiente heredaría la
   * identidad de la anterior y el test mentiría.
   */
  async function conRol<T>(
    rol: string,
    claims: string | null,
    sql: string,
    params: unknown[],
  ): Promise<readonly T[]> {
    return pg.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true)`, [rol]);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims ?? '']);
      const resultado = await tx.query<T>(sql, params);
      return resultado.rows;
    });
  }

  return {
    crudo,

    comoUsuario: (usuarioId, sql, params = []) =>
      conRol(
        'authenticated',
        JSON.stringify({ sub: usuarioId, role: 'authenticated' }),
        sql,
        params,
      ),

    comoAnonimo: (sql, params = []) => conRol('anon', null, sql, params),

    comoSistema: (sql, params = []) => conRol('service_role', null, sql, params),

    async crearUsuario(email, nombre) {
      const filas = await crudo<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, jsonb_build_object('nombre', $2::text)) returning id`,
        [email, nombre ?? null],
      );
      const id = filas[0]?.id;
      if (id === undefined) throw new Error('No se pudo crear el usuario de prueba');
      return id;
    },

    async crearTenant(propietarioId, nombre, slug, presupuesto = 10) {
      const filas = await conRol<{ id: string }>(
        'authenticated',
        JSON.stringify({ sub: propietarioId, role: 'authenticated' }),
        `select app.crear_tenant($1, $2, 'Europe/Madrid', 'es', true, $3) as id`,
        [nombre, slug, presupuesto],
      );
      const id = filas[0]?.id;
      if (id === undefined) throw new Error('No se pudo crear el tenant de prueba');
      return id;
    },

    async anadirMiembro(tenantId, usuarioId, rol) {
      await crudo(
        `insert into public.memberships (tenant_id, usuario_id, rol) values ($1, $2, $3)`,
        [tenantId, usuarioId, rol],
      );
    },

    async tablasDeTenant() {
      const filas = await crudo<{ tabla: string }>(
        `select c.relname as tabla
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join information_schema.columns col
           on col.table_schema = n.nspname and col.table_name = c.relname
         where n.nspname = 'public' and c.relkind = 'r' and col.column_name = 'tenant_id'
         order by c.relname`,
      );
      return filas.map((f) => f.tabla);
    },

    async sembrarTodasLasTablas(tenantId) {
      const uuidCero = '00000000-0000-0000-0000-000000000000';

      const eventos = await crudo<{ id: string }>(
        `insert into public.events (tenant_id, nombre, agente, datos)
         values ($1, 'prospect.ingested', 'prospeccion', '{"nota":"sembrado"}'::jsonb)
         returning id`,
        [tenantId],
      );
      const eventId = eventos[0]?.id;
      if (eventId === undefined) throw new Error('No se pudo sembrar un evento');

      await crudo(
        `insert into public.event_runs (tenant_id, event_id, funcion) values ($1, $2, 'sembrada')`,
        [tenantId, eventId],
      );
      await crudo(
        `insert into public.event_reinyecciones (tenant_id, event_id, motivo, quien)
         values ($1, $2, 'sembrada para el test de fuga', 'test')`,
        [tenantId, eventId],
      );
      await crudo(
        `insert into public.approvals (tenant_id, agente, tipo, titulo, contenido_propuesto)
         values ($1, 'prueba', 'mensaje', 'Sembrada', '{"texto":"sembrado"}'::jsonb)`,
        [tenantId],
      );
      // El id del tenant va dos veces a propósito: como `uuid` en la columna y
      // como `text` en el email y el hash. Postgres deduce un solo tipo por
      // parámetro, así que reutilizar `$1` con un cast no vale.
      await crudo(
        `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en)
         values ($1, 'sembrada-' || $2 || '@ejemplo.test', 'lector', 'hash-' || $2, now() + interval '7 days')`,
        [tenantId, tenantId],
      );

      const archivos = await crudo<{ id: string }>(
        `insert into public.tenant_files (tenant_id, carpeta, nombre)
         values ($1, 'context', 'sembrado.pdf') returning id`,
        [tenantId],
      );
      const fileId = archivos[0]?.id;
      if (fileId === undefined) throw new Error('No se pudo sembrar un archivo');

      await crudo(
        `insert into public.tenant_file_versions
           (tenant_id, file_id, version, ruta, tamano_bytes, mime, sha256)
         values ($1, $2, 1, $3 || '/context/sembrado.pdf', 1024, 'application/pdf', repeat('a', 64))`,
        [tenantId, fileId, tenantId],
      );

      await crudo(
        `insert into public.agent_configs (tenant_id, agente, config, nivel_autonomia)
         values ($1, 'prueba', '{"tono":"neutro"}'::jsonb, 'L1')`,
        [tenantId],
      );
      await crudo(
        `insert into public.flow_configs (tenant_id, paso, config)
         values ($1, 'cualificacion', '{"umbral":50}'::jsonb)`,
        [tenantId],
      );
      await crudo(
        `insert into public.tenant_secrets (tenant_id, nombre, vault_secret_id)
         values ($1, 'PRUEBA_TOKEN', $2)`,
        [tenantId, uuidCero],
      );
      await crudo(
        `insert into public.spend_ledger (tenant_id, concepto, coste_eur, agente)
         values ($1, 'llm', 0.01, 'prueba')`,
        [tenantId],
      );
      await crudo(
        `insert into public.machines (tenant_id, tipo, nombre, salud)
         values ($1, 'buzon-google', 'sembrado', 'buena')`,
        [tenantId],
      );

      // `tenants` y `tenant_budgets` los crea ya `app.crear_tenant`.
      return [
        'agent_configs',
        'approvals',
        'event_reinyecciones',
        'event_runs',
        'events',
        'flow_configs',
        'invitaciones',
        'machines',
        'memberships',
        'spend_ledger',
        'tenant_budgets',
        'tenant_file_versions',
        'tenant_files',
        'tenant_secrets',
      ];
    },

    async cerrar() {
      await pg.close();
    },
  };
}
