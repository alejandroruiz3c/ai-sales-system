/**
 * Catálogo de modelos y su precio (F2.1).
 *
 * El router no elige «un modelo»: elige **el más barato capaz** de un nivel de
 * tarea. Para eso necesita saber dos cosas de cada modelo, su nivel y su
 * precio, y las dos están aquí y en ningún otro sitio.
 *
 * Los niveles son los del plan (§2.6):
 *
 *   · **ligero**: clasificar, deduplicar, detectar intención, filtrar;
 *   · **medio**: redactar mensajes, guiones y resúmenes;
 *   · **alto**: interpretar el onboarding y resolver lo ambiguo, con uso muy
 *     puntual.
 *
 * Un modelo de nivel superior es capaz de las tareas de los inferiores, así que
 * «el más barato capaz» de una tarea ligera es el más barato de **todos** los
 * modelos disponibles, y el de una tarea alta, el más barato entre los altos.
 * Si mañana sale un modelo medio más barato que el ligero actual, se añade aquí
 * y las tareas ligeras pasan a usarlo sin tocar a ningún agente.
 *
 * **Precios en dólares por millón de tokens**, que es como los publica
 * Anthropic, verificados el 2026-09-25. La conversión a euros la hace
 * `coste.ts` con un tipo de cambio que entra por parámetro, porque el libro de
 * gasto (`spend_ledger`) y los presupuestos de los tenants están en euros.
 */

export const NIVELES = ['ligero', 'medio', 'alto'] as const;
export type Nivel = (typeof NIVELES)[number];

const ORDEN_DE_NIVEL: Readonly<Record<Nivel, number>> = { ligero: 0, medio: 1, alto: 2 };

/** Precio por millón de tokens, en dólares. */
export interface Precio {
  readonly entrada: number;
  readonly salida: number;
  /** Escribir en la caché con el TTL de 5 minutos: 1,25 × la entrada. */
  readonly escrituraCache: number;
  /** Leer de la caché. Es la cifra que hace rentable cachear el perfil. */
  readonly lecturaCache: number;
}

/**
 * Cómo se le pide a cada modelo que no piense de más.
 *
 * No es un detalle: en una clasificación, el razonamiento se cobra como salida
 * y puede multiplicar el coste por diez sin mejorar la respuesta. Cada familia
 * se controla de una forma distinta y equivocarse devuelve un 400:
 *
 *   · `ninguno`: el modelo no piensa si no se le pide (Haiku 4.5), y no
 *     admite el parámetro de esfuerzo;
 *   · `desactivable`: admite `thinking: disabled` (Sonnet 5);
 *   · `solo-esfuerzo`: el razonamiento no se puede apagar y solo se modula con
 *     el esfuerzo (Opus 5.5).
 */
export type ControlDePensamiento = 'ninguno' | 'desactivable' | 'solo-esfuerzo';

export interface Modelo {
  /** Identificador exacto del proveedor. */
  readonly id: string;
  readonly nombre: string;
  readonly nivel: Nivel;
  readonly precio: Precio;
  /**
   * Tamaño mínimo del prefijo para que la caché se active, en tokens. Por
   * debajo, marcar el bloque no da error: simplemente no cachea. El router lo
   * usa para explicar en la traza por qué no hubo acierto.
   */
  readonly minimoCacheable: number;
  readonly maxTokensSalida: number;
  readonly pensamiento: ControlDePensamiento;
}

/**
 * Los modelos que el router puede elegir.
 *
 * Tres, uno por nivel, porque hoy el más barato de cada nivel es también el
 * único que tiene sentido: Opus 5.5 cuesta menos que Opus 5 y es más capaz,
 * así que Opus 5 no gana nunca y no está. Un modelo que no gana nunca es solo
 * una forma de equivocarse al elegir.
 */
export const MODELOS: readonly Modelo[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    nombre: 'Claude Haiku 4.5',
    nivel: 'ligero',
    precio: { entrada: 1, salida: 5, escrituraCache: 1.25, lecturaCache: 0.1 },
    minimoCacheable: 4096,
    maxTokensSalida: 64_000,
    pensamiento: 'ninguno',
  },
  {
    id: 'claude-sonnet-5',
    nombre: 'Claude Sonnet 5',
    nivel: 'medio',
    precio: { entrada: 2, salida: 10, escrituraCache: 2.5, lecturaCache: 0.2 },
    minimoCacheable: 1024,
    maxTokensSalida: 128_000,
    pensamiento: 'desactivable',
  },
  {
    id: 'claude-opus-5-5',
    nombre: 'Claude Opus 5.5',
    nivel: 'alto',
    precio: { entrada: 4, salida: 20, escrituraCache: 5, lecturaCache: 0.2 },
    minimoCacheable: 512,
    maxTokensSalida: 128_000,
    pensamiento: 'solo-esfuerzo',
  },
];

/** Coste de referencia de un modelo: lo que cuesta una llamada típica. */
function costeDeReferencia(modelo: Modelo): number {
  // Una llamada típica del sistema lee unas cuatro veces más de lo que
  // escribe. Comparar solo por precio de entrada daría por bueno un modelo
  // que es barato leyendo y caro escribiendo.
  return modelo.precio.entrada * 4 + modelo.precio.salida;
}

export class SinModeloCapaz extends Error {
  constructor(nivel: Nivel) {
    super(`No hay ningún modelo disponible capaz de una tarea de nivel «${nivel}».`);
    this.name = 'SinModeloCapaz';
  }
}

/**
 * El modelo más barato capaz de un nivel.
 *
 * `disponibles` existe para dos cosas: los tests, que prueban la regla con un
 * catálogo inventado, y el día en que un proveedor no ofrezca uno de los
 * modelos del catálogo.
 */
export function elegirModelo(nivel: Nivel, disponibles: readonly Modelo[] = MODELOS): Modelo {
  const capaces = disponibles.filter((m) => ORDEN_DE_NIVEL[m.nivel] >= ORDEN_DE_NIVEL[nivel]);
  const [primero, ...resto] = capaces;
  if (primero === undefined) throw new SinModeloCapaz(nivel);
  return resto.reduce(
    (mejor, m) => (costeDeReferencia(m) < costeDeReferencia(mejor) ? m : mejor),
    primero,
  );
}

export function modeloPorId(
  id: string,
  disponibles: readonly Modelo[] = MODELOS,
): Modelo | undefined {
  return disponibles.find((m) => m.id === id);
}
