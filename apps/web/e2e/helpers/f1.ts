import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { requireLabPassword } from './lab.ts';

/**
 * Apoyos para el kit de F1.
 *
 * El kit es un recorrido —crear, invitar, subir, aprobar—, así que los tests
 * comparten estado y corren en serie. Lo que hay aquí es lo que se repite.
 */

/** Sello único por ejecución, para que dos pasadas no se pisen. */
export const SELLO = `${String(Date.now())}${String(Math.floor(Math.random() * 1000))}`;

/**
 * Los correos de prueba empiezan por `e2e.` **a propósito**: es el patrón que
 * el reset de la sala de pruebas reconoce para poder borrarlos, y el que
 * garantiza que ese botón no puede llevarse por delante la cuenta de nadie.
 */
export const correo = (quien: string): string => `e2e.${quien}.${SELLO}@ejemplo.test`;

/** Contraseñas de los usuarios de prueba. No abren nada más que este entorno. */
export const CONTRASENA = `Prueba-E2E-${SELLO}`;

export const NOMBRE_UNO = `Corporate Uno Demo ${SELLO}`;
export const NOMBRE_DOS = `Corporate Dos Demo ${SELLO}`;

/** Deja el entorno de pruebas como recién instalado. */
export async function resetearEntorno(request: APIRequestContext, baseURL: string): Promise<void> {
  const login = await request.post(`${baseURL}/api/lab/login`, {
    form: { password: requireLabPassword() },
    maxRedirects: 0,
  });
  if (login.status() !== 303) {
    throw new Error(`El login de /lab ha devuelto ${String(login.status())}`);
  }
  const respuesta = await request.post(`${baseURL}/api/lab/reset`);
  if (!respuesta.ok()) {
    throw new Error(
      `El reset ha devuelto ${String(respuesta.status())}: ${await respuesta.text()}`,
    );
  }
}

/** Una pestaña nueva, sin sesión heredada. */
export async function pestanaLimpia(navegador: Browser): Promise<Page> {
  const contexto = await navegador.newContext({ locale: 'es-ES' });
  return contexto.newPage();
}

export async function crearCorporate(
  pagina: Page,
  nombre: string,
  presupuesto = '5',
): Promise<void> {
  await pagina.goto('/panel/nuevo');
  await pagina.getByTestId('corporate-nombre').fill(nombre);
  await pagina.getByTestId('corporate-presupuesto').fill(presupuesto);
  await pagina.getByTestId('corporate-crear').click();
  await pagina.waitForURL('**/panel', { timeout: 30_000 });
}

/**
 * Cambia de corporate y **espera a que el servidor lo sepa**.
 *
 * La versión ingenua —seleccionar y `waitForURL('**\/panel')`— no sirve, y es
 * un error que engaña: el cambio se hace con un formulario que responde con una
 * redirección a `/panel`, y como la página ya está en `/panel`, `waitForURL`
 * resuelve de inmediato, antes de que la cookie haya llegado. La navegación
 * siguiente se renderiza con el corporate anterior, y lo que falla es un caso
 * dos pasos más allá, por un motivo que no tiene nada que ver.
 *
 * Así que se comprueba contra el servidor recargando, y no contra el DOM: el
 * `select` cambia de valor en el navegador aunque la cookie no haya viajado.
 */
export async function cambiarA(pagina: Page, nombre: string): Promise<void> {
  await pagina.goto('/panel');
  const selector = pagina.getByTestId('selector-corporate');

  const valor = await selector
    .locator('option')
    .evaluateAll(
      (opciones, buscado) =>
        (opciones as HTMLOptionElement[]).find((o) => o.textContent.startsWith(buscado))?.value ??
        '',
      nombre,
    );
  if (valor === '') throw new Error(`«${nombre}» no aparece en el selector de corporate`);
  if ((await selector.inputValue()) === valor) return;

  await selector.selectOption(valor);

  for (let intento = 0; intento < 20; intento += 1) {
    await pagina.waitForTimeout(500);
    await pagina.goto('/panel');
    if ((await selector.inputValue()) === valor) return;
  }
  throw new Error(`El cambio a «${nombre}» no ha llegado al servidor`);
}

/**
 * Elige un corporate en la sala de pruebas, por valor y comprobándolo.
 *
 * Por valor y no por etiqueta porque las etiquetas llevan un sello de tiempo y
 * un fallo de coincidencia daría un error de «no encontrado» que no dice cuál
 * de los dos corporates esperaba. Y se comprueba después porque el `select` es
 * controlado por React: si el cambio no llegara al estado, la llamada saldría
 * con el corporate anterior y el caso fallaría en otro sitio.
 */
export async function elegirEnLab(pagina: Page, nombre: string): Promise<void> {
  const selector = pagina.getByTestId('lab-corporate');
  const valor = await selector
    .locator('option')
    .evaluateAll(
      (opciones, buscado) =>
        (opciones as HTMLOptionElement[]).find((o) => o.textContent.startsWith(buscado))?.value ??
        '',
      nombre,
    );
  if (valor === '') throw new Error(`«${nombre}» no aparece entre los corporates de prueba`);
  await selector.selectOption(valor);
  if ((await selector.inputValue()) !== valor) {
    throw new Error(`La sala de pruebas no ha aceptado el cambio a «${nombre}»`);
  }
}
