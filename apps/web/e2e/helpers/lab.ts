import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Contraseña de la sala de pruebas del entorno contra el que corren los tests.
 *
 * Si no está, los tests de `/lab` se omiten en lugar de fallar: que no haya
 * secreto configurado en CI no es un fallo del sistema.
 */
export const labPassword = process.env['E2E_LAB_PASSWORD'];

export function requireLabPassword(): string {
  if (labPassword === undefined || labPassword === '') {
    throw new Error('E2E_LAB_PASSWORD no está definida');
  }
  return labPassword;
}

/** Entra en `/lab` por el formulario y deja la sesión en el contexto. */
export async function loginToLab(page: Page): Promise<void> {
  await page.goto('/lab/login');
  await page.getByTestId('lab-password').fill(requireLabPassword());
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/lab');
}

/** Obtiene la cookie de sesión de `/lab` para usarla en peticiones de API. */
export async function labApiContext(request: APIRequestContext, baseURL: string): Promise<void> {
  const response = await request.post(`${baseURL}/api/lab/login`, {
    form: { password: requireLabPassword() },
    maxRedirects: 0,
  });
  if (response.status() !== 303) {
    throw new Error(`El login de /lab ha devuelto ${String(response.status())}`);
  }
}
