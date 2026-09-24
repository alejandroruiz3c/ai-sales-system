/**
 * @sales-os/agent-prueba · el agente ficticio del kit de prueba
 *
 * Existe porque los casos T1.7, T1.8 y T1.9 necesitan un agente **que no sea
 * ninguno de los reales**. Probar el nivel de autonomía con el agente de
 * emailing significaría que un fallo del kit puede mandar un correo, y probar
 * el corte de presupuesto con él significaría gastar de verdad.
 *
 * Lo que hace es lo mínimo para que las tres cosas se puedan comprobar de punta
 * a punta:
 *
 *   · **genera** una acción de prueba (un texto inofensivo, sin un solo dato de
 *     negocio: regla permanente 3);
 *   · **decide si la envía** según su nivel de autonomía, y esa decisión es la
 *     que el caso T1.9 comprueba;
 *   · **cuesta** una cantidad fija y conocida por llamada, para que el caso
 *     T1.8 sea aritmética y no una estimación.
 *
 * No conoce su runtime (CLAUDE.md §1): ni importa `next`, ni lee `process.env`,
 * ni habla con la base. Recibe su configuración y su reloj por parámetro, y
 * devuelve **qué habría que hacer**. Quién lo persiste y quién lo envía es
 * asunto de quien lo llama, y por eso la misma lógica vale en una función de
 * Vercel, en un worker y en un test.
 */

import { z } from 'zod';

export const NIVELES = ['L0', 'L1', 'L2', 'L3'] as const;
export type Nivel = (typeof NIVELES)[number];

/** La clave con la que el agente aparece en la configuración del tenant. */
export const CLAVE_DEL_AGENTE = 'prueba';

/**
 * Lo que cuesta una llamada de prueba, en euros.
 *
 * `0,05` no es un número al azar: el caso T1.8 pone el presupuesto en 0,50 € y
 * pulsa veinte veces. Con este coste, la quinta llamada cruza el 50 %, la
 * octava el 80 % y la décima agota; de la once a la veinte rebotan. Los tres
 * umbrales caen en llamadas distintas y exactas, así que el caso se puede
 * comprobar sin interpretar nada.
 */
export const COSTE_POR_LLAMADA_EUR = 0.05;

export const esquemaConfigDePrueba = z.object({
  nivelAutonomia: z.enum(NIVELES),
  /** Texto con el que el agente firma lo que genera. Sin datos de negocio. */
  tono: z.enum(['neutro', 'cercano', 'formal', 'directo']),
  /** Cuántas acciones puede enviar al día cuando va solo (L2 y L3). */
  limiteDiario: z.number().int().min(0).max(1000),
});

export type ConfigDePrueba = z.infer<typeof esquemaConfigDePrueba>;

export const CONFIG_POR_DEFECTO: ConfigDePrueba = {
  nivelAutonomia: 'L1',
  tono: 'neutro',
  limiteDiario: 10,
};

/** Qué hay que hacer con lo que el agente ha generado. */
export type Destino =
  | { readonly tipo: 'solo-generar'; readonly motivo: string }
  | { readonly tipo: 'pedir-aprobacion'; readonly motivo: string }
  | { readonly tipo: 'enviar'; readonly motivo: string };

export interface AccionDePrueba {
  /** Lo que el agente ha «redactado». */
  readonly contenido: string;
  readonly nivel: Nivel;
  readonly destino: Destino;
  /** Nombre del evento que hay que publicar al generar. */
  readonly eventoGenerado: 'prueba.accion.generada';
  /** Nombre del evento de la acción, que solo se publica si de verdad se envía. */
  readonly eventoEnviado: 'prueba.accion.enviada';
  readonly costeEur: number;
}

export interface EntradaDePrueba {
  readonly config: ConfigDePrueba;
  /** Cuántas acciones ha enviado ya hoy este agente. */
  readonly enviadasHoy?: number;
  /** Texto que quien llama quiere que aparezca, para reconocer su prueba. */
  readonly nota?: string;
  readonly ahora?: Date;
}

const FRASE_POR_TONO: Readonly<Record<ConfigDePrueba['tono'], string>> = {
  neutro: 'Esta es una acción de prueba generada por el agente ficticio.',
  cercano: '¡Hola! Esto es una acción de prueba del agente ficticio.',
  formal: 'Le informamos de que esta es una acción de prueba del agente ficticio.',
  directo: 'Acción de prueba. Agente ficticio.',
};

/**
 * Decide qué hacer con la acción según el nivel de autonomía.
 *
 * Los cuatro niveles del plan, y la diferencia entre ellos es lo único que el
 * caso T1.9 tiene que poder ver:
 *
 *   · **L0** genera y no envía. Nunca. Es el modo con el que se prueba un
 *     agente nuevo sin que pueda tocar a nadie;
 *   · **L1** genera y espera aprobación humana. Es el valor por defecto de
 *     todo agente, y el que hace que la cola de aprobaciones tenga sentido;
 *   · **L2** envía solo mientras esté dentro de su límite. Al llegar al límite
 *     deja de enviar, no pide permiso: pedir permiso al llegar al límite
 *     convertiría un tope en una molestia que alguien acabaría aprobando;
 *   · **L3** envía sin límite por nivel. El tope sigue existiendo, pero lo pone
 *     el planificador de capacidad por máquina (F13), no el agente.
 */
export function decidirDestino(config: ConfigDePrueba, enviadasHoy: number): Destino {
  switch (config.nivelAutonomia) {
    case 'L0':
      return {
        tipo: 'solo-generar',
        motivo: 'Nivel L0: el agente genera la acción y no la envía nunca.',
      };
    case 'L1':
      return {
        tipo: 'pedir-aprobacion',
        motivo: 'Nivel L1: la acción necesita que una persona la apruebe antes de salir.',
      };
    case 'L2':
      return enviadasHoy >= config.limiteDiario
        ? {
            tipo: 'solo-generar',
            motivo: `Nivel L2: límite diario alcanzado (${String(config.limiteDiario)}). Se reanuda mañana.`,
          }
        : {
            tipo: 'enviar',
            motivo: `Nivel L2: dentro del límite diario (${String(enviadasHoy + 1)} de ${String(config.limiteDiario)}).`,
          };
    case 'L3':
      return { tipo: 'enviar', motivo: 'Nivel L3: el agente actúa sin pedir permiso.' };
  }
}

export function generarAccionDePrueba(entrada: EntradaDePrueba): AccionDePrueba {
  const { config } = entrada;
  const enviadasHoy = entrada.enviadasHoy ?? 0;
  const ahora = entrada.ahora ?? new Date();
  const nota = entrada.nota?.trim();

  const contenido = [
    FRASE_POR_TONO[config.tono],
    nota === undefined || nota === '' ? undefined : `Nota: ${nota}`,
    `Generada el ${ahora.toISOString()} con nivel ${config.nivelAutonomia}.`,
  ]
    .filter((linea): linea is string => linea !== undefined)
    .join(' ');

  return {
    contenido,
    nivel: config.nivelAutonomia,
    destino: decidirDestino(config, enviadasHoy),
    eventoGenerado: 'prueba.accion.generada',
    eventoEnviado: 'prueba.accion.enviada',
    costeEur: COSTE_POR_LLAMADA_EUR,
  };
}

/** Ficha corta del agente, para el panel y para el Estudio (F2B). */
export const FICHA = {
  clave: CLAVE_DEL_AGENTE,
  nombre: 'Agente de prueba',
  resumen:
    'Agente ficticio que genera una acción inofensiva. Sirve para comprobar la cola de aprobaciones, el corte de presupuesto y el nivel de autonomía sin tocar a ningún prospecto.',
  eventos: ['prueba.accion.generada', 'prueba.accion.enviada'] as const,
  costePorLlamadaEur: COSTE_POR_LLAMADA_EUR,
} as const;
