import { defineConfig } from 'vitest/config';

/**
 * Vitest solo mira `src/`.
 *
 * Los tests de `e2e/` son de Playwright: si Vitest los recoge, falla con
 * "Playwright Test did not expect test.describe() to be called here", que es un
 * mensaje que cuesta media hora de depuración a quien lo ve por primera vez.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
