/**
 * @sales-os/core
 *
 * Tipos, contratos de eventos Zod, máquina de estados, errores y reglas transversales
 *
 * Paquete reservado en F0. Se implementa en F1–F6. Lo único que ya vive aquí es
 * el log estructurado (F0.11), porque lo necesitan el panel y los workers y
 * ninguno de los dos puede tener su propia copia.
 */

export {
  crearLogger,
  redactar,
  redactarCampos,
  type Logger,
  type LoggerConfig,
  type LogEntry,
  type LogFields,
  type LogLevel,
} from './log.ts';

export interface PackageManifest {
  /** Nombre del paquete en el workspace. */
  readonly name: string;
  /** Qué resuelve este paquete. */
  readonly description: string;
  /** Fase del plan en la que se implementa. */
  readonly phase: string;
}

export const manifest: PackageManifest = {
  name: '@sales-os/core',
  description:
    'Tipos, contratos de eventos Zod, máquina de estados, errores y reglas transversales',
  phase: 'F1–F6',
};
