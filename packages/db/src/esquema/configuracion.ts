/**
 * Validación de la configuración de agentes y de pasos del flujo (F1.8).
 *
 * El `jsonb` de `agent_configs.config` no lo valida Postgres a propósito: lo
 * valida Zod aquí. El motivo es que el esquema tiene que poder evolucionar por
 * agente y, sobre todo, tiene que poder **enseñarse**: el generador de
 * formularios del Estudio (F2B.3) construye la pantalla a partir de esta
 * declaración, y los mensajes de error de abajo son literalmente los que va a
 * leer Alex.
 *
 * De ahí que los mensajes estén escritos en castellano y digan qué hacer, no
 * qué regla se ha incumplido. «Expected number, received string» es correcto y
 * no sirve de nada en un panel.
 *
 * Lo que sí decide Postgres son las cosas de las que depende el aislamiento o
 * una salvaguarda: el tenant, la clave del agente y el nivel de autonomía
 * tienen columna y `check`.
 */

import { z } from 'zod';
import { es } from 'zod/locales';

import { NIVELES_AUTONOMIA } from './index.ts';

/**
 * Mensajes de Zod en castellano.
 *
 * Los mensajes de más abajo dicen qué hacer y son los buenos. Esto cubre el
 * resto: el «falta este campo» y el «esto no es un número» que aparecen cuando
 * llega un cuerpo incompleto desde el panel o desde la API. Sin la localización
 * el usuario leería «Invalid input: expected string, received undefined», que
 * es exacto e inútil.
 */
z.config(es());

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Días de la semana, con lunes = 1, como `isodow` de Postgres. */
export const esquemaDiasDeLaSemana = z
  .array(z.number().int().min(1).max(7))
  .min(1, { error: 'Elige al menos un día de la semana.' })
  .max(7);

export const esquemaVentanaHoraria = z
  .object({
    desde: z
      .string()
      .regex(HORA, { error: 'La hora de inicio tiene que ser HH:MM, de 00:00 a 23:59.' }),
    hasta: z
      .string()
      .regex(HORA, { error: 'La hora de fin tiene que ser HH:MM, de 00:00 a 23:59.' }),
    dias: esquemaDiasDeLaSemana,
  })
  // La comparación solo se hace si las dos horas tienen forma de hora. Con
  // `desde: '25:00'`, comparar cadenas daría además un «la hora de fin tiene
  // que ser posterior», que es cierto y desconcertante: el problema es el 25.
  .refine((v) => !HORA.test(v.desde) || !HORA.test(v.hasta) || v.desde < v.hasta, {
    error: 'La hora de fin tiene que ser posterior a la de inicio.',
    path: ['hasta'],
  });

/**
 * Límites por agente. El tope de 10.000 no es un número bonito: es la frontera
 * entre «un límite alto» y «un dedo que se ha quedado pulsado». Los máximos
 * absolutos de verdad los pone el planificador de capacidad (F13) y son
 * salvaguarda bloqueada, no configuración de tenant.
 */
export const esquemaLimites = z.object({
  porDia: z
    .number({ error: 'El límite diario tiene que ser un número.' })
    .int({ error: 'El límite diario tiene que ser un número entero.' })
    .min(0, { error: 'El límite diario no puede ser negativo. Pon 0 para desactivar el canal.' })
    .max(10_000, {
      error:
        'El límite diario no puede pasar de 10.000. Si necesitas más, hacen falta más máquinas.',
    }),
  porSemana: z
    .number({ error: 'El límite semanal tiene que ser un número.' })
    .int({ error: 'El límite semanal tiene que ser un número entero.' })
    .min(0, { error: 'El límite semanal no puede ser negativo. Pon 0 para desactivar el canal.' })
    .max(70_000, { error: 'El límite semanal no puede pasar de 70.000.' }),
});

export const esquemaConfigDeAgente = z
  .object({
    objetivo: z
      .string()
      .trim()
      .min(10, {
        error: 'Explica en una frase qué tiene que conseguir el agente (al menos 10 caracteres).',
      })
      .max(500, { error: 'El objetivo es para una frase: máximo 500 caracteres.' }),
    tono: z.enum(['neutro', 'cercano', 'formal', 'directo'], {
      error: 'Elige un tono: neutro, cercano, formal o directo.',
    }),
    idioma: z.enum(['es', 'en'], { error: 'Elige un idioma: es o en.' }),
    nivelAutonomia: z.enum(NIVELES_AUTONOMIA, {
      error: 'El nivel de autonomía es L0, L1, L2 o L3.',
    }),
    ventanaHoraria: esquemaVentanaHoraria,
    limites: esquemaLimites,
    /** Archivos del tenant que el agente puede usar como contexto. */
    recursosAdjuntos: z.array(z.uuid({ error: 'Un recurso adjunto se identifica por su uuid.' })),
    /** Ajustes propios de cada agente. Su forma la declara el registro en F2B. */
    especifico: z.record(z.string(), z.unknown()),
  })
  .refine((v) => v.limites.porSemana === 0 || v.limites.porSemana >= v.limites.porDia, {
    error: 'El límite semanal no puede ser menor que el diario.',
    path: ['limites', 'porSemana'],
  });

export type ConfigDeAgente = z.infer<typeof esquemaConfigDeAgente>;

export const esquemaConfigDePaso = z.object({
  descripcion: z.string().trim().min(3).max(500),
  /** Umbral de cualificación, orden de canales, reglas de parada… */
  criterios: z.record(z.string(), z.unknown()),
});

export type ConfigDePaso = z.infer<typeof esquemaConfigDePaso>;

/** Un error de validación tal como lo va a leer una persona en el panel. */
export interface ErrorDeConfig {
  /** Ruta del campo, en notación de puntos: `limites.porDia`. */
  readonly campo: string;
  readonly mensaje: string;
}

/**
 * Traduce un fallo de validación a algo que se pueda pintar junto al campo.
 *
 * Existe porque «Config inválida rechazada con mensaje claro» (F1.8) y «el
 * panel lo rechaza con un mensaje comprensible» (T1.6) son el mismo requisito
 * visto desde dos sitios, y el `ZodError` crudo no lo cumple ni de lejos.
 */
export function erroresDeConfig(error: z.ZodError): readonly ErrorDeConfig[] {
  return error.issues.map((issue) => ({
    campo: issue.path.map(String).join('.') || '(raíz)',
    mensaje: issue.message,
  }));
}

export interface ResultadoDeValidacion<T> {
  readonly valida: boolean;
  readonly datos?: T;
  readonly errores: readonly ErrorDeConfig[];
}

export function validarConfigDeAgente(valor: unknown): ResultadoDeValidacion<ConfigDeAgente> {
  const resultado = esquemaConfigDeAgente.safeParse(valor);
  if (resultado.success) {
    return { valida: true, datos: resultado.data, errores: [] };
  }
  return { valida: false, errores: erroresDeConfig(resultado.error) };
}

export function validarConfigDePaso(valor: unknown): ResultadoDeValidacion<ConfigDePaso> {
  const resultado = esquemaConfigDePaso.safeParse(valor);
  if (resultado.success) {
    return { valida: true, datos: resultado.data, errores: [] };
  }
  return { valida: false, errores: erroresDeConfig(resultado.error) };
}

/**
 * Configuración de partida de un agente cualquiera.
 *
 * **Sin un solo dato de negocio** (regla permanente 3): ni qué vende el
 * corporate, ni a quién, ni con qué argumentos. El objetivo está redactado con
 * variables del perfil comercial, que es lo que rellena el onboarding (F3). Si
 * al escribir un valor por defecto hace falta saber qué vende el corporate, el
 * dato que falta es una variable, no una frase.
 */
export function configDeAgentePorDefecto(objetivo: string): ConfigDeAgente {
  return {
    objetivo,
    tono: 'neutro',
    idioma: 'es',
    // L1 por defecto: el agente propone y una persona aprueba. Arrancar en L2 o
    // L3 sería arrancar mandando cosas sin que nadie las haya visto.
    nivelAutonomia: 'L1',
    ventanaHoraria: { desde: '09:00', hasta: '19:00', dias: [1, 2, 3, 4, 5] },
    limites: { porDia: 0, porSemana: 0 },
    recursosAdjuntos: [],
    especifico: {},
  };
}
