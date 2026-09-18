/**
 * Log estructurado con destino Better Stack (F0.11).
 *
 * Dos reglas gobiernan este módulo, y las dos son del plan:
 *
 * 1. **Sin datos personales.** Los logs salen del sistema hacia un tercero y se
 *    conservan. Un email de prospecto en un log es un dato personal en un
 *    proveedor que no es el nuestro, sin base legal y sin forma de borrarlo a
 *    petición del interesado. Por eso el log no acepta texto libre con datos:
 *    `redactar` limpia lo que reconoce, y los campos van en un objeto con
 *    nombres explícitos.
 * 2. **No conoce su runtime.** Recibe la configuración por parámetro, así que
 *    sirve igual en una función de Vercel, en un worker de Hetzner y en un test
 *    (CLAUDE.md §1). El que lee `process.env` es quien lo construye.
 *
 * La redacción es defensa en profundidad, no permiso para ser descuidado: lo
 * correcto sigue siendo no meter un email en un log. Esto está para el día en
 * que alguien lo haga de todos modos.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Campos permitidos en un log. Nada de texto libre con datos de una persona. */
export interface LogFields {
  /** Siempre que exista un tenant en contexto. Nada se diagnostica sin él. */
  readonly tenantId?: string;
  /** Nombre del evento del bus, si el log viene de uno. */
  readonly event?: string;
  /** Identificador técnico opaco: un id de fila, de ejecución o de traza. */
  readonly id?: string;
  readonly durationMs?: number;
  readonly count?: number;
  readonly outcome?: 'ok' | 'bloqueado' | 'reintento' | 'fallo';
  /** Cualquier otro dato técnico. Se redacta antes de salir. */
  readonly [clave: string]: string | number | boolean | undefined;
}

export interface LogEntry {
  readonly dt: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly service: string;
  readonly environment: string;
  readonly version?: string;
  readonly fields: Record<string, string | number | boolean>;
}

export interface LoggerConfig {
  readonly service: string;
  readonly environment: string;
  readonly version?: string;
  /** Token de la fuente de Better Stack. Sin él, el log solo va a consola. */
  readonly sourceToken?: string;
  /** Host de ingesta de la fuente. Sin él, el log solo va a consola. */
  readonly ingestingHost?: string;
  /** Inyectable para los tests. */
  readonly fetch?: typeof globalThis.fetch;
  /** Inyectable para los tests. */
  readonly now?: () => Date;
  /** A dónde va la copia local. Por defecto, la consola. */
  readonly sink?: (entrada: LogEntry) => void;
}

/**
 * El resto de patrones de datos personales y de secretos, en el orden en que se
 * aplican.
 */
/** El email se aplica aparte y primero. Ver `redactar`. */
const EMAIL = { patron: /[\w.+-]+@[\w-]+\.[\w.-]+/g, por: '[email]' } as const;

const PATRONES: readonly { readonly patron: RegExp; readonly por: string }[] = [
  { patron: /\b[A-Z]?\d{7,8}[A-Z]\b/g, por: '[documento]' },
  { patron: /\bhttps?:\/\/(?:www\.)?linkedin\.com\/in\/[\w%-]+/gi, por: '[perfil-linkedin]' },
  // Tokens y claves: si uno se cuela en un log, el log es el nuevo sitio desde
  // el que se filtra.
  {
    patron:
      /\b(?:sk-|sk_live_|pk_live_|rk_live_|whsec_|xoxb-|ghp_|github_pat_|gho_|sntry[su]_|sbp_|signkey-)[A-Za-z0-9_-]{6,}/g,
    por: '[secreto]',
  },
  { patron: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, por: '[jwt]' },
];

/**
 * Un teléfono no tiene una forma, tiene doce. `+34 612 34 56 78`,
 * `(91) 123 45 67`, `+1 (415) 555-2671` y `612345678` son todos el mismo dato, y
 * cualquier expresión regular que intente casarlos de una vez deja fuera la
 * mitad o se come números técnicos.
 *
 * Así que se busca el candidato —una tira de dígitos, espacios, puntos, guiones
 * y paréntesis— y se decide contando: entre 9 y 15 dígitos es un teléfono.
 */
const CANDIDATO_TELEFONO = /\+?\(?\d[\d\s().-]{7,18}\d/g;

/** Una fecha ISO tiene 8 dígitos y guiones, y no es un teléfono. */
const PARECE_FECHA = /\d{4}-\d{2}-\d{2}/;

function redactarTelefonos(texto: string): string {
  return texto.replace(CANDIDATO_TELEFONO, (candidato) => {
    if (PARECE_FECHA.test(candidato)) return candidato;
    const digitos = candidato.replace(/\D/g, '').length;
    return digitos >= 9 && digitos <= 15 ? '[telefono]' : candidato;
  });
}

/** Sustituye por una etiqueta todo lo que parezca un dato personal o un secreto. */
export function redactar(texto: string): string {
  // El email va primero: lleva dígitos que el contador de teléfonos
  // reconocería, y dejaría medio email en el log.
  let resultado = texto.replace(EMAIL.patron, EMAIL.por);
  resultado = redactarTelefonos(resultado);
  for (const { patron, por } of PATRONES) {
    resultado = resultado.replace(patron, por);
  }
  return resultado;
}

/** Aplica `redactar` a los valores de texto y descarta los `undefined`. */
export function redactarCampos(campos: LogFields): Record<string, string | number | boolean> {
  const limpio: Record<string, string | number | boolean> = {};
  for (const [clave, valor] of Object.entries(campos)) {
    if (valor === undefined) continue;
    limpio[clave] = typeof valor === 'string' ? redactar(valor) : valor;
  }
  return limpio;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Construye la entrada sin enviarla. Para tests y para /status. */
  entrada(level: LogLevel, message: string, fields?: LogFields): LogEntry;
  /** Envía una entrada y dice si Better Stack la ha aceptado. */
  enviar(entrada: LogEntry): Promise<{ readonly enviado: boolean; readonly detalle: string }>;
  readonly activo: boolean;
}

function consola(entrada: LogEntry): void {
  const linea = JSON.stringify(entrada);
  if (entrada.level === 'error') console.error(linea);
  else console.warn(linea);
}

export function crearLogger(config: LoggerConfig): Logger {
  const ahora = config.now ?? (() => new Date());
  const hacerFetch = config.fetch ?? globalThis.fetch;
  const volcar = config.sink ?? consola;
  const activo =
    config.sourceToken !== undefined &&
    config.sourceToken !== '' &&
    config.ingestingHost !== undefined &&
    config.ingestingHost !== '';

  function entrada(level: LogLevel, message: string, fields: LogFields = {}): LogEntry {
    return {
      dt: ahora().toISOString(),
      level,
      message: redactar(message),
      service: config.service,
      environment: config.environment,
      ...(config.version === undefined ? {} : { version: config.version }),
      fields: redactarCampos(fields),
    };
  }

  async function enviar(
    linea: LogEntry,
  ): Promise<{ readonly enviado: boolean; readonly detalle: string }> {
    if (!activo) {
      return { enviado: false, detalle: 'Better Stack no está configurado en este entorno.' };
    }
    const host = (config.ingestingHost ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    try {
      const respuesta = await hacerFetch(`https://${host}/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.sourceToken ?? ''}`,
        },
        body: JSON.stringify(linea),
        signal: AbortSignal.timeout(5000),
      });
      if (!respuesta.ok) {
        return {
          enviado: false,
          detalle:
            respuesta.status === 401 || respuesta.status === 403
              ? 'El token de la fuente no es válido para ese host de ingesta.'
              : `El host de ingesta responde HTTP ${String(respuesta.status)}.`,
        };
      }
      return { enviado: true, detalle: `Aceptado por ${host}.` };
    } catch (error) {
      return {
        enviado: false,
        detalle: `No se ha podido enviar: ${error instanceof Error ? error.message : 'error desconocido'}`,
      };
    }
  }

  function registrar(level: LogLevel, message: string, fields?: LogFields): void {
    const linea = entrada(level, message, fields);
    volcar(linea);
    if (!activo) return;
    // El log no puede bloquear la petición: si Better Stack tarda o falla, la
    // copia de consola ya está escrita y eso es suficiente para no perder el
    // rastro.
    void enviar(linea);
  }

  return {
    debug: (m, f) => {
      registrar('debug', m, f);
    },
    info: (m, f) => {
      registrar('info', m, f);
    },
    warn: (m, f) => {
      registrar('warn', m, f);
    },
    error: (m, f) => {
      registrar('error', m, f);
    },
    entrada,
    enviar,
    activo,
  };
}
