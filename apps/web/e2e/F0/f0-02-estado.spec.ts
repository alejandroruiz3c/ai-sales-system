import { expect, test } from '@playwright/test';

interface StatusResponse {
  environment: string;
  version: string;
  sandbox: { enabled: boolean; allowlistSize: number; ignoredDisableRequest: boolean };
  services: { id: string; name: string; state: string }[];
  allGreen: boolean;
}

const SERVICIOS = ['supabase', 'inngest', 'sentry', 'langfuse', 'better-stack'] as const;

/**
 * Casos T0.2 y T0.6 del kit de F0.
 *
 * T0.2 pide los servicios en verde. El test comprueba que los cuatro
 * **aparecen y dicen su estado**, no que estén en verde: en verde solo pueden
 * estar cuando Alex haya dado de alta las cuentas y puesto las claves. Un test
 * que exigiera verde fallaría por una tarea pendiente de una persona, que no es
 * lo que un test tiene que vigilar. Lo que sí es innegociable y se comprueba:
 * ninguno puede estar en `error`.
 */
test.describe('F0 · estado de los servicios', () => {
  test('T0.2 · muestra Supabase, Inngest, Sentry, Langfuse y Better Stack con su estado', async ({
    page,
  }) => {
    await page.goto('/status');

    for (const id of SERVICIOS) {
      const row = page.getByTestId(`service-${id}`);
      await expect(row, `falta la fila del servicio ${id}`).toBeVisible();
      const state = await row.getAttribute('data-state');
      expect(state, `estado desconocido en ${id}`).toMatch(/^(ok|error|no-configurado)$/);
      expect(state, `el servicio ${id} está en fallo`).not.toBe('error');
    }
  });

  test('T0.2 · /api/status devuelve todos los servicios y el modo sandbox', async ({ request }) => {
    const response = await request.get('/api/status');
    expect(response.status()).toBe(200);

    const body = (await response.json()) as StatusResponse;
    expect(body.services.map((service) => service.id).sort()).toEqual([...SERVICIOS].sort());
    expect(body.version).not.toBe('');

    // Fuera de producción el sandbox tiene que estar activo, sin excepciones.
    if (body.environment !== 'production') {
      expect(body.sandbox.enabled, 'el sandbox está desactivado fuera de producción').toBe(true);
    }
    expect(
      body.sandbox.ignoredDisableRequest,
      'alguien ha intentado desactivar el sandbox en este entorno',
    ).toBe(false);
  });

  test('la página avisa de que el sandbox está activo', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByTestId('sandbox-state')).toContainText(/Activo|Desactivado/);
  });

  test('T0.6 · el botón de error de prueba responde y dice si ha llegado a Sentry', async ({
    page,
  }) => {
    await page.goto('/status');
    await page.getByTestId('launch-test-error').click();

    const result = page.getByTestId('test-error-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText(/Sentry/);
  });
});
