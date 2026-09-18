/**
 * Caché en memoria de vida muy corta, para respuestas caras de calcular.
 *
 * Existe por un fallo concreto: `/status` comprueba cinco servicios externos con
 * peticiones de verdad, y los E2E de fase lo abren desde siete workers en
 * paralelo. Eso son 35 llamadas salientes en un segundo, y alguna se pasa del
 * tiempo de espera: el test fallaba por saturación, no porque nada estuviera
 * roto.
 *
 * Una caché de segundos lo arregla sin mentir: un informe de salud de hace diez
 * segundos sigue siendo un informe de salud. Lo que no vale es cachear minutos,
 * porque entonces `/status` deja de decir lo que pasa ahora.
 *
 * El reloj se inyecta para poder probar la expiración sin esperar.
 */

export interface CacheBreve<T> {
  /** Devuelve el valor cacheado si está fresco; si no, lo calcula y lo guarda. */
  obtener(calcular: () => Promise<T>): Promise<T>;
  /** Tira lo cacheado. Para tests y para un botón de recargar. */
  invalidar(): void;
}

export function crearCacheBreve<T>(
  ttlMs: number,
  ahora: () => number = () => Date.now(),
): CacheBreve<T> {
  let guardado: { readonly valor: T; readonly expiraEn: number } | undefined;
  /**
   * Si llegan varias peticiones a la vez y no hay nada cacheado, comparten el
   * mismo cálculo en vuelo. Sin esto, la caché no evitaría la ráfaga inicial,
   * que es justo la que provocaba el fallo.
   */
  let enVuelo: Promise<T> | undefined;

  return {
    async obtener(calcular) {
      const t = ahora();
      if (guardado !== undefined && guardado.expiraEn > t) return guardado.valor;
      if (enVuelo !== undefined) return enVuelo;

      enVuelo = calcular()
        .then((valor) => {
          guardado = { valor, expiraEn: ahora() + ttlMs };
          return valor;
        })
        .finally(() => {
          enVuelo = undefined;
        });

      return enVuelo;
    },
    invalidar() {
      guardado = undefined;
    },
  };
}
