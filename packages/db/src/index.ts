/**
 * @sales-os/db
 *
 * Esquema, migraciones versionadas, políticas RLS y el único acceso a Postgres.
 *
 * Lo que este paquete garantiza y el resto del sistema da por hecho:
 *
 *   · **toda tabla lleva `tenant_id` y RLS**, y hay un test que recorre el
 *     esquema y falla si aparece una que no (ADR 0003, ADR 0009);
 *   · **solo hay tres formas de consultar** —`conRLS`, `comoSistema` y
 *     `conRolAnonimo`— y las tres fijan el rol dentro de su transacción. El
 *     manejador crudo no sale de `cliente.ts`;
 *   · **la tabla `events` es append-only** por trigger, no por convención, que
 *     es la condición con la que el ADR 0002 aceptó Inngest en la ruta crítica;
 *   · **los secretos de tenant no son legibles con una sesión de usuario**: la
 *     función que devuelve el valor solo la puede ejecutar `service_role`.
 */

export { crearBaseDeDatos, type BaseDeDatos, type ConfigBaseDeDatos } from './cliente.ts';

export {
  aplicarMigraciones,
  cargarMigraciones,
  CARPETA_MIGRACIONES,
  type EjecutorSql,
  type Migracion,
  type ResultadoMigracion,
} from './migraciones.ts';

export {
  configDeAgentePorDefecto,
  erroresDeConfig,
  esquemaConfigDeAgente,
  esquemaConfigDePaso,
  esquemaLimites,
  esquemaVentanaHoraria,
  validarConfigDeAgente,
  validarConfigDePaso,
  type ConfigDeAgente,
  type ConfigDePaso,
  type ErrorDeConfig,
  type ResultadoDeValidacion,
} from './esquema/configuracion.ts';

export * as esquema from './esquema/index.ts';

export {
  CARPETAS,
  NIVELES_AUTONOMIA,
  ROLES,
  TABLAS_SIN_TENANT_ID,
  type Carpeta,
  type NivelAutonomia,
  type Rol,
} from './esquema/index.ts';

export interface PackageManifest {
  readonly name: string;
  readonly description: string;
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/db',
  description: 'Esquema Drizzle, migraciones versionadas, políticas RLS y seeds',
  phase: 'F1',
};
