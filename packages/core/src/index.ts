/**
 * @sales-os/core
 *
 * Tipos, contratos de eventos Zod, máquina de estados, errores y reglas transversales
 *
 * En F1 vive aquí lo que el panel y los workers necesitan por igual y ninguno
 * de los dos puede tener en copia propia: el log estructurado (F0.11) y los
 * contratos de eventos del bus (F1.10, plan §2.5).
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

export {
  claveDeConcurrencia,
  desdeNombreInngest,
  esquemaEvento,
  NOMBRES_DE_EVENTO,
  nombreInngest,
  ORIGENES_DE_EVENTO,
  PREFIJO_INNGEST,
  validarEvento,
  type Evento,
  type NombreDeEvento,
  type OrigenDeEvento,
  type ResultadoDeValidacionDeEvento,
} from './eventos.ts';

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
