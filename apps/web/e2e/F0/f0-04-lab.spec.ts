import { expect, test } from '@playwright/test';

import { labPassword, loginToLab, requireLabPassword } from '../helpers/lab.ts';

/**
 * DoD de F0.16: "/lab accesible solo con rol admin".
 *
 * En F0 el control es una contraseña de entorno; en F1.3 pasa a ser el rol
 * `admin` de Supabase Auth. Lo que este test fija y debe seguir cumpliéndose
 * después del cambio es que **sin credencial no se entra**.
 */
test.describe('F0 · sala de pruebas', () => {
  test('sin sesión no se entra en /lab', async ({ page }) => {
    const response = await page.goto('/lab');

    // O redirige al login, o dice que la sala no está habilitada en el entorno.
    const url = page.url();
    if (url.includes('/lab/login')) {
      await expect(page.getByRole('heading', { name: 'Sala de pruebas' })).toBeVisible();
    } else {
      expect(response?.status()).toBeLessThan(500);
      await expect(page.getByText('Sala de pruebas no habilitada')).toBeVisible();
    }

    // En ningún caso se ven las herramientas de dentro.
    await expect(page.getByTestId('sandbox-submit')).toHaveCount(0);
    await expect(page.getByTestId('event-list')).toHaveCount(0);
  });

  test('las API de /lab rechazan a quien no tiene sesión', async ({ request }) => {
    for (const endpoint of ['/api/lab/events', '/api/lab/hello']) {
      const response =
        endpoint === '/api/lab/events' ? await request.get(endpoint) : await request.post(endpoint);
      expect(response.status(), `${endpoint} no está protegido`).toBe(403);
    }
  });

  test.describe('con la contraseña correcta', () => {
    test.skip(
      labPassword === undefined || labPassword === '',
      'Falta E2E_LAB_PASSWORD para entrar en /lab',
    );

    test('una contraseña incorrecta no abre la sala', async ({ page }) => {
      await page.goto('/lab/login');
      await page.getByTestId('lab-password').fill(`${requireLabPassword()}-incorrecta`);
      await page.getByRole('button', { name: 'Entrar' }).click();

      await expect(page).toHaveURL(/\/lab\/login/);
      await expect(page.getByTestId('lab-login-error')).toBeVisible();
    });

    test('con la contraseña correcta se ven el visor de eventos y el probador', async ({
      page,
    }) => {
      await loginToLab(page);

      await expect(page.getByRole('heading', { name: 'Sala de pruebas', level: 1 })).toBeVisible();
      await expect(page.getByTestId('sandbox-submit')).toBeVisible();
      await expect(page.getByTestId('event-count')).toBeVisible();
      await expect(page.getByTestId('inngest-hello')).toBeVisible();
    });

    test('el visor registra la decisión del sandbox como evento', async ({ page }) => {
      await loginToLab(page);

      await page.getByTestId('sandbox-recipient').fill('otro.prospecto@empresa-real.es');
      await page.getByTestId('sandbox-submit').click();
      await expect(page.getByTestId('sandbox-result')).toBeVisible();

      // El visor sondea cada 2 s; el evento tiene que aparecer solo.
      await expect(page.getByTestId('event-list')).toContainText('sandbox/envio.bloqueado.v1', {
        timeout: 15_000,
      });
    });
  });
});
