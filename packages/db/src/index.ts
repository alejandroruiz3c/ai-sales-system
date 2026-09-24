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

/**
 * Las migraciones **no se exportan desde aquí**, sino desde
 * `@sales-os/db/migraciones`.
 *
 * El motivo es concreto y costó un rato encontrarlo: `migraciones.ts` lee la
 * carpeta de ficheros SQL del disco, así que al importarlo desde el panel el
 * empaquetador lo incluía en el bundle y `import.meta.dirname` quedaba sin
 * valor. El síntoma era un 500 en la página de entrada con «The "path"
 * argument must be of type string», que no menciona ni migraciones ni disco.
 *
 * Separarlo en dos entradas convierte eso en imposible: el panel importa
 * `@sales-os/db` y no hay forma de que arrastre código que necesita un sistema
 * de ficheros.
 */

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
