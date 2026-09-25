import { describe, expect, it } from 'vitest';

import { elegirModelo, MODELOS, SinModeloCapaz, type Modelo } from './modelos.ts';

function modelo(id: string, nivel: Modelo['nivel'], entrada: number, salida: number): Modelo {
  return {
    id,
    nombre: id,
    nivel,
    precio: { entrada, salida, escrituraCache: entrada * 1.25, lecturaCache: entrada / 10 },
    minimoCacheable: 1024,
    maxTokensSalida: 8000,
    pensamiento: 'ninguno',
  };
}

describe('elegirModelo (F2.1)', () => {
  it('una tarea de clasificación (nivel ligero) usa el modelo ligero', () => {
    expect(elegirModelo('ligero').id).toBe('claude-haiku-4-5-20251001');
  });

  it('redactar (medio) usa Sonnet 5 y lo ambiguo (alto) usa Opus 5.5', () => {
    expect(elegirModelo('medio').id).toBe('claude-sonnet-5');
    expect(elegirModelo('alto').id).toBe('claude-opus-5-5');
  });

  it('elige el más barato **capaz**: si un modelo medio es más barato que el ligero, las tareas ligeras lo usan', () => {
    const catalogo = [
      modelo('ligero-caro', 'ligero', 3, 15),
      modelo('medio-barato', 'medio', 1, 4),
    ];
    expect(elegirModelo('ligero', catalogo).id).toBe('medio-barato');
  });

  it('nunca baja de nivel: una tarea alta no usa un modelo medio aunque sea más barato', () => {
    const catalogo = [modelo('medio', 'medio', 1, 4), modelo('alto', 'alto', 5, 25)];
    expect(elegirModelo('alto', catalogo).id).toBe('alto');
  });

  it('compara por una llamada típica, no solo por el precio de entrada', () => {
    const catalogo = [
      modelo('lee-barato', 'ligero', 0.5, 30),
      modelo('equilibrado', 'ligero', 1, 5),
    ];
    expect(elegirModelo('ligero', catalogo).id).toBe('equilibrado');
  });

  it('sin ningún modelo capaz, lo dice con el nivel en vez de devolver cualquiera', () => {
    expect(() => elegirModelo('alto', [modelo('solo-ligero', 'ligero', 1, 5)])).toThrow(
      SinModeloCapaz,
    );
  });

  it('el catálogo tiene un modelo por nivel y cada uno es el más barato de su nivel hacia arriba', () => {
    expect(new Set(MODELOS.map((m) => m.nivel)).size).toBe(3);
    for (const m of MODELOS) expect(elegirModelo(m.nivel).id).toBe(m.id);
  });
});
