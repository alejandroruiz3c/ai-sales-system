/**
 * Esquema Drizzle del núcleo multi-tenant.
 *
 * **La fuente de verdad del esquema son las migraciones SQL**, no este fichero.
 * Aquí está la descripción con la que el panel consulta con tipos, y el riesgo
 * evidente de tener dos descripciones de lo mismo es que se separen. Por eso
 * existe `pruebas/deriva-de-esquema.test.ts`: aplica las migraciones a un
 * Postgres de verdad y compara tabla por tabla y columna por columna con lo que
 * hay aquí. Si alguien añade una columna en el SQL y se olvida de este fichero,
 * el test lo dice.
 *
 * Un detalle que no es cosmético: **toda tabla lleva `tenantId`**, salvo
 * `perfiles`, que es la excepción documentada del ADR 0009.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Roles de un usuario dentro de un corporate. El orden es de más a menos. */
export const ROLES = ['propietario', 'administrador', 'editor', 'lector'] as const;
export type Rol = (typeof ROLES)[number];

/** Niveles de autonomía de un agente (plan §F1.12). */
export const NIVELES_AUTONOMIA = ['L0', 'L1', 'L2', 'L3'] as const;
export type NivelAutonomia = (typeof NIVELES_AUTONOMIA)[number];

/** Carpetas de archivos de un tenant. */
export const CARPETAS = ['context', 'inputs', 'outputs'] as const;
export type Carpeta = (typeof CARPETAS)[number];

// ── perfiles ─────────────────────────────────────────────────────────────────

export const perfiles = pgTable('perfiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  nombre: text('nombre'),
  esAdminPlataforma: boolean('es_admin_plataforma').notNull().default(false),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

// ── tenants ──────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  nombre: text('nombre').notNull(),
  slug: text('slug').notNull(),
  estado: text('estado').notNull().default('activo'),
  zonaHoraria: text('zona_horaria').notNull().default('Europe/Madrid'),
  idioma: text('idioma').notNull().default('es'),
  plan: text('plan').notNull().default('piloto'),
  esDemo: boolean('es_demo').notNull().default(false),
  creadoPor: uuid('creado_por'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

// ── memberships ──────────────────────────────────────────────────────────────

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    usuarioId: uuid('usuario_id').notNull(),
    rol: text('rol').$type<Rol>().notNull(),
    estado: text('estado').notNull().default('activa'),
    invitadoPor: uuid('invitado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('memberships_tenant_usuario').on(t.tenantId, t.usuarioId)],
);

// ── invitaciones ─────────────────────────────────────────────────────────────

export const invitaciones = pgTable(
  'invitaciones',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    rol: text('rol').$type<Exclude<Rol, 'propietario'>>().notNull(),
    tokenHash: text('token_hash').notNull(),
    estado: text('estado').notNull().default('pendiente'),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
    creadaPor: uuid('creada_por'),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    aceptadaEn: timestamp('aceptada_en', { withTimezone: true }),
    usuarioId: uuid('usuario_id'),
  },
  (t) => [index('invitaciones_por_tenant').on(t.tenantId)],
);

// ── events ───────────────────────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    nombre: text('nombre').notNull(),
    version: integer('version').notNull().default(1),
    agente: text('agente').notNull().default('sistema'),
    datos: jsonb('datos').notNull().default({}),
    origen: text('origen').notNull().default('panel'),
    correlacionId: uuid('correlacion_id'),
    claveIdempotencia: text('clave_idempotencia'),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_por_tenant').on(t.tenantId, t.creadoEn)],
);

export const eventRuns = pgTable('event_runs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull(),
  funcion: text('funcion').notNull(),
  estado: text('estado').notNull().default('en_curso'),
  inngestRunId: text('inngest_run_id'),
  intento: integer('intento').notNull().default(1),
  error: text('error'),
  iniciadoEn: timestamp('iniciado_en', { withTimezone: true }).notNull().defaultNow(),
  terminadoEn: timestamp('terminado_en', { withTimezone: true }),
});

export const eventReinyecciones = pgTable('event_reinyecciones', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull(),
  motivo: text('motivo').notNull(),
  quien: text('quien').notNull(),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

// ── approvals ────────────────────────────────────────────────────────────────

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    agente: text('agente').notNull(),
    tipo: text('tipo').notNull(),
    titulo: text('titulo').notNull(),
    estado: text('estado').notNull().default('pendiente'),
    contenidoPropuesto: jsonb('contenido_propuesto').notNull(),
    contenidoFinal: jsonb('contenido_final'),
    editada: boolean('editada').notNull().default(false),
    motivo: text('motivo'),
    eventoAlAprobar: text('evento_al_aprobar'),
    eventoEmitidoId: uuid('evento_emitido_id'),
    origenEventId: uuid('origen_event_id'),
    creadaPor: uuid('creada_por'),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    resueltaPor: uuid('resuelta_por'),
    resueltaEn: timestamp('resuelta_en', { withTimezone: true }),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('approvals_por_estado').on(t.tenantId, t.estado)],
);

// ── archivos ─────────────────────────────────────────────────────────────────

export const tenantFiles = pgTable(
  'tenant_files',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    carpeta: text('carpeta').$type<Carpeta>().notNull(),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion'),
    versionActual: integer('version_actual').notNull().default(0),
    borradoEn: timestamp('borrado_en', { withTimezone: true }),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenant_files_por_carpeta').on(t.tenantId, t.carpeta)],
);

export const tenantFileVersions = pgTable(
  'tenant_file_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    fileId: uuid('file_id').notNull(),
    version: integer('version').notNull(),
    ruta: text('ruta').notNull(),
    tamanoBytes: bigint('tamano_bytes', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    sha256: text('sha256').notNull(),
    nota: text('nota'),
    subidoPor: uuid('subido_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenant_file_versions_unica').on(t.fileId, t.version)],
);

// ── configuración ────────────────────────────────────────────────────────────

export const agentConfigs = pgTable(
  'agent_configs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    agente: text('agente').notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    nivelAutonomia: text('nivel_autonomia').$type<NivelAutonomia>().notNull().default('L1'),
    nota: text('nota'),
    revertidaDe: integer('revertida_de'),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_configs_version').on(t.tenantId, t.agente, t.version)],
);

export const flowConfigs = pgTable(
  'flow_configs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    paso: text('paso').notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    nota: text('nota'),
    revertidaDe: integer('revertida_de'),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('flow_configs_version').on(t.tenantId, t.paso, t.version)],
);

// ── secretos ─────────────────────────────────────────────────────────────────

/**
 * Inventario de credenciales por tenant. El valor **no está aquí**: está
 * cifrado en Vault y solo lo lee `app.leer_secreto`, cuyo `execute` se concede
 * únicamente a `service_role`. Esta tabla no tiene ni políticas ni `grant` para
 * `authenticated`: con la sesión de un usuario no devuelve cero filas, devuelve
 * permiso denegado.
 */
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    nombre: text('nombre').notNull(),
    vaultSecretId: uuid('vault_secret_id').notNull(),
    descripcion: text('descripcion'),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
    ultimoUsoEn: timestamp('ultimo_uso_en', { withTimezone: true }),
  },
  (t) => [uniqueIndex('tenant_secrets_nombre').on(t.tenantId, t.nombre)],
);

// ── coste ────────────────────────────────────────────────────────────────────

export const tenantBudgets = pgTable(
  'tenant_budgets',
  {
    tenantId: uuid('tenant_id').notNull(),
    mes: date('mes').notNull(),
    limiteEur: numeric('limite_eur', { precision: 12, scale: 4 }).notNull().default('0'),
    avisado50: boolean('avisado_50').notNull().default(false),
    avisado80: boolean('avisado_80').notNull().default(false),
    cortado: boolean('cortado').notNull().default(false),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.mes] })],
);

export const spendLedger = pgTable(
  'spend_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    fecha: date('fecha').notNull(),
    agente: text('agente').notNull().default('sistema'),
    concepto: text('concepto').notNull(),
    modelo: text('modelo'),
    tokensEntrada: integer('tokens_entrada').notNull().default(0),
    tokensSalida: integer('tokens_salida').notNull().default(0),
    costeEur: numeric('coste_eur', { precision: 12, scale: 6 }).notNull(),
    cacheAcertada: boolean('cache_acertada').notNull().default(false),
    referencia: text('referencia'),
    eventId: uuid('event_id'),
    creadoPor: uuid('creado_por'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('spend_ledger_por_fecha').on(t.tenantId, t.fecha)],
);

// ── máquinas ─────────────────────────────────────────────────────────────────

export const machines = pgTable(
  'machines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    tipo: text('tipo').notNull(),
    nombre: text('nombre').notNull(),
    estado: text('estado').notNull().default('nueva'),
    salud: text('salud').notNull().default('desconocida'),
    limiteDiario: integer('limite_diario'),
    limiteSemanal: integer('limite_semanal'),
    calentamientoDesde: date('calentamiento_desde'),
    ultimaRevisionEn: timestamp('ultima_revision_en', { withTimezone: true }),
    notas: text('notas'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('machines_por_estado').on(t.tenantId, t.estado)],
);

/**
 * Tablas de `public` que **no** llevan `tenant_id`, con su motivo.
 *
 * Es una lista, no un criterio, y eso es deliberado: para añadir una tabla aquí
 * hay que editar este array en un PR, y el test de aislamiento lo lee. Una
 * excepción que hay que escribir es una excepción que alguien revisa.
 */
export const TABLAS_SIN_TENANT_ID: Readonly<Record<string, string>> = {
  perfiles:
    'La identidad de una persona es anterior a los tenants y atraviesa varios. Su aislamiento es por auth.uid(), que es más estrecho que por tenant (ADR 0009).',
  tenants:
    'Es la tabla del propio tenant: su columna de tenant es `id`, y su política comprueba la pertenencia sobre ella.',
};
