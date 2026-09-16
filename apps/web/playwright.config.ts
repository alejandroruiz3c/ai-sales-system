import { defineConfig, devices } from '@playwright/test';

/**
 * Tests E2E de aceptación por fase (F0.17).
 *
 * Contra **staging** en CI (`E2E_BASE_URL`), contra un servidor local cuando no
 * hay URL. El plan (§5B.2) pide que cada caso automatizable del kit de prueba
 * exista también como test de Playwright y corra en CI contra el entorno real:
 * un test que solo pasa en local no dice nada del entorno que Alex va a abrir.
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3100';
const usaStagingRemoto = process.env['E2E_BASE_URL'] !== undefined;

export default defineConfig({
  testDir: './e2e',
  // Un test que falla en CI y pasa en local suele ser un test que depende del
  // orden. Con `fullyParallel` se detecta antes.
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  ...(process.env['CI'] ? { workers: 2 } : {}),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  ...(usaStagingRemoto
    ? {}
    : {
        webServer: {
          command: 'pnpm build && PORT=3100 pnpm start',
          url: 'http://127.0.0.1:3100/api/status',
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
          stdout: 'pipe',
        },
      }),
});
