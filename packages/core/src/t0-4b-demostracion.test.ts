/**
 * Test roto A PROPÓSITO. No fusionar nunca.
 *
 * Demuestra el caso T0.4b del kit de prueba de F0: «abres un PR con un test roto
 * a propósito y el check de Vercel falla y no se despliega la preview».
 *
 * Es la prueba de que la puerta de calidad del repositorio funciona de verdad.
 * El plan gratuito de GitHub no permite proteger `main`, y Actions está
 * bloqueado a nivel de cuenta, así que lo único que impide que entre código roto
 * es que el build de Vercel ejecuta `pnpm verify` antes de construir
 * (ADR 0007). Si este PR llegara a tener el check en verde, esa afirmación
 * sería falsa y F0.7 no estaría cumplida.
 *
 * El PR que contiene este fichero se cierra sin fusionar.
 */

import { describe, expect, it } from 'vitest';

describe('T0.4b · demostración de la puerta de calidad', () => {
  it('falla a propósito para que el check de Vercel se ponga en rojo', () => {
    expect(2 + 2).toBe(5);
  });
});
