import { expect, test } from '@playwright/test';

/**
 * Caso T0.1 del kit de F0: "Abres la URL de staging → carga la página
 * SALES OS v0 con número de versión".
 */
test.describe('F0 · página de inicio', () => {
  test('T0.1 · carga "SALES OS v0" con su versión y su entorno', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('SALES OS v0');

    const version = page.getByTestId('version');
    await expect(version).toBeVisible();
    // La versión tiene que ser algo, no una cadena vacía ni "undefined".
    await expect(version).not.toHaveText('');
    await expect(version).not.toHaveText(/undefined|null/);

    await expect(page.getByTestId('environment')).not.toHaveText('');
    await expect(page.getByTestId('phase')).toHaveText('F0');
  });

  test('lleva a la página de estado y a la sala de pruebas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Estado de los servicios' }).click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { name: 'Estado de los servicios' })).toBeVisible();
  });
});
