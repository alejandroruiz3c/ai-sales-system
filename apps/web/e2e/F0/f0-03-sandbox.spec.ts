import { expect, test } from '@playwright/test';

import { labApiContext, labPassword, loginToLab } from '../helpers/lab.ts';

/**
 * DoD de F0.15: "Test: envío a destino no permitido bloqueado".
 *
 * Este es el test que no se puede perder nunca: si deja de pasar, staging puede
 * escribir a un prospecto real.
 */
test.describe('F0 · interceptor de modo sandbox', () => {
  test('un intento sin sesión de administrador no llega ni a evaluarse', async ({ request }) => {
    const response = await request.post('/api/lab/sandbox-check', {
      data: { channel: 'email', recipient: 'quien.sea@ejemplo.es' },
    });
    expect(response.status()).toBe(403);
  });

  test.describe('con sesión de administrador', () => {
    test.skip(
      labPassword === undefined || labPassword === '',
      'Falta E2E_LAB_PASSWORD para entrar en /lab',
    );

    test('bloquea un destinatario que no está en la lista blanca, en todos los canales', async ({
      request,
      baseURL,
    }) => {
      await labApiContext(request, baseURL ?? '');

      const casos = [
        { channel: 'email', recipient: 'director.general@empresa-real-no-autorizada.es' },
        { channel: 'whatsapp', recipient: '+34999888777' },
        { channel: 'voice', recipient: '+34999888777' },
        { channel: 'linkedin', recipient: 'https://www.linkedin.com/in/perfil-no-autorizado/' },
        { channel: 'social', recipient: 'reddit:u/no-autorizado' },
      ];

      for (const caso of casos) {
        const response = await request.post('/api/lab/sandbox-check', { data: caso });
        expect(response.status()).toBe(200);
        const decision = (await response.json()) as { allowed: boolean; reason?: string };
        expect(decision.allowed, `¡${caso.channel} → ${caso.recipient} NO se ha bloqueado!`).toBe(
          false,
        );
        expect(decision.reason).toBeTruthy();
      }
    });

    test('un destinatario mal formado se bloquea por precaución', async ({ request, baseURL }) => {
      await labApiContext(request, baseURL ?? '');
      const response = await request.post('/api/lab/sandbox-check', {
        data: { channel: 'voice', recipient: 'esto-no-es-un-telefono' },
      });
      const decision = (await response.json()) as { allowed: boolean; reason?: string };
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('destinatario-no-interpretable');
    });

    test('desde /lab se ve el motivo del bloqueo', async ({ page }) => {
      await loginToLab(page);

      await page.getByTestId('sandbox-recipient').fill('director@empresa-real-no-autorizada.es');
      await page.getByTestId('sandbox-submit').click();

      const result = page.getByTestId('sandbox-result');
      await expect(result).toBeVisible();
      await expect(result).toHaveAttribute('data-allowed', 'false');
      await expect(result).toContainText('Bloqueado');
      await expect(result).toContainText('lista blanca');
    });
  });
});
