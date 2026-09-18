import { describe, expect, it, vi } from 'vitest';

import { crearCacheBreve } from './cache-breve.ts';

describe('crearCacheBreve', () => {
  it('calcula una vez y reutiliza mientras esté fresco', async () => {
    let reloj = 1000;
    const calcular = vi.fn().mockResolvedValue('informe');
    const cache = crearCacheBreve<string>(10_000, () => reloj);

    expect(await cache.obtener(calcular)).toBe('informe');
    reloj = 5000;
    expect(await cache.obtener(calcular)).toBe('informe');
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('recalcula cuando expira', async () => {
    let reloj = 1000;
    const calcular = vi.fn().mockResolvedValueOnce('viejo').mockResolvedValueOnce('nuevo');
    const cache = crearCacheBreve<string>(10_000, () => reloj);

    expect(await cache.obtener(calcular)).toBe('viejo');
    reloj = 11_001;
    expect(await cache.obtener(calcular)).toBe('nuevo');
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('varias peticiones a la vez comparten un solo cálculo', async () => {
    // Es la parte que de verdad arregla el fallo: sin esto, la ráfaga inicial
    // de siete workers de Playwright lanzaría siete comprobaciones completas.
    let resolver: ((v: string) => void) | undefined;
    const calcular = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolver = res;
        }),
    );
    const cache = crearCacheBreve<string>(10_000, () => 1000);

    const peticiones = [cache.obtener(calcular), cache.obtener(calcular), cache.obtener(calcular)];
    resolver?.('informe');

    expect(await Promise.all(peticiones)).toEqual(['informe', 'informe', 'informe']);
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('si el cálculo falla, no se cachea el fallo', async () => {
    const calcular = vi
      .fn()
      .mockRejectedValueOnce(new Error('la red se ha caído'))
      .mockResolvedValueOnce('informe');
    const cache = crearCacheBreve<string>(10_000, () => 1000);

    await expect(cache.obtener(calcular)).rejects.toThrow('la red se ha caído');
    expect(await cache.obtener(calcular)).toBe('informe');
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('invalidar fuerza a recalcular', async () => {
    const calcular = vi.fn().mockResolvedValue('informe');
    const cache = crearCacheBreve<string>(10_000, () => 1000);

    await cache.obtener(calcular);
    cache.invalidar();
    await cache.obtener(calcular);
    expect(calcular).toHaveBeenCalledTimes(2);
  });
});
