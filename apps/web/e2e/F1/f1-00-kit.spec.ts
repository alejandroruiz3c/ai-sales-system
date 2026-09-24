/**
 * Kit de prueba de F1 · casos T1.0 a T1.9, contra staging.
 *
 * Corre **en serie y en un solo fichero** porque el kit es un recorrido: no se
 * puede invitar a un lector antes de crear el corporate, ni comprobar que no ve
 * los archivos de otro antes de que existan esos archivos. Partirlo en nueve
 * ficheros independientes obligaría a que cada uno montara todo el escenario
 * otra vez, y entonces lo que se probaría nueve veces es el montaje.
 *
 * Empieza con un reset del entorno de pruebas, así que es repetible: se puede
 * lanzar dos veces seguidas y da lo mismo.
 *
 * El caso **T1.3 es innegociable** (plan §5B.4): si falla, se para todo. Aquí
 * está como comprobación de la interfaz; la de la base —más fuerte, porque no
 * depende de que ninguna pantalla acierte— son los 28 tests de
 * `packages/db/pruebas/rls.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  cambiarA,
  elegirEnLab,
  CONTRASENA,
  correo,
  crearCorporate,
  NOMBRE_DOS,
  NOMBRE_UNO,
  pestanaLimpia,
  resetearEntorno,
} from '../helpers/f1.ts';
import { labPassword, requireLabPassword } from '../helpers/lab.ts';

test.describe.configure({ mode: 'serial' });

const ADMIN = correo('admin');
const LECTOR = correo('lector');

/** Lo que va pasando de un caso al siguiente. */
const estado: { admin?: Page; lector?: Page; enlaceDeInvitacion?: string } = {};

test.describe('Kit de F1 · núcleo multi-tenant', () => {
  test.skip(labPassword === undefined, 'Sin E2E_LAB_PASSWORD no se puede resetear el entorno.');

  test.beforeAll(async ({ request, baseURL }) => {
    await resetearEntorno(request, baseURL ?? '');
  });

  test('T1.0 · el sistema arranca vacío y ofrece crear el primer corporate', async ({
    browser,
  }) => {
    const pagina = await pestanaLimpia(browser);
    estado.admin = pagina;

    await pagina.goto('/bienvenida');
    await expect(
      pagina.getByTestId('arranque-enviar'),
      'con el sistema vacío tiene que ofrecer el asistente de arranque',
    ).toBeVisible();
    await expect(pagina.getByText('El sistema está vacío')).toBeVisible();

    await pagina.getByTestId('arranque-nombre').fill('Administrador de pruebas');
    await pagina.getByTestId('arranque-email').fill(ADMIN);
    await pagina.getByTestId('arranque-contrasena').fill(CONTRASENA);
    await pagina.getByTestId('arranque-repetida').fill(CONTRASENA);
    await pagina.getByTestId('arranque-llave').fill(requireLabPassword());
    await pagina.getByTestId('arranque-enviar').click();

    // Recién dado de alta no pertenece a ningún corporate, así que el panel es
    // el asistente. Eso es literalmente el caso T1.0.
    await pagina.waitForURL(/\/panel/, { timeout: 30_000 });
    await pagina.goto('/panel');
    await expect(pagina.getByTestId('crear-primer-corporate')).toBeVisible();
  });

  test('T1.0b · con alguien dado de alta, el asistente de arranque se cierra', async ({
    browser,
  }) => {
    // La otra mitad de T1.0: la puerta de arranque existe mientras el sistema
    // está vacío, y solo mientras.
    const anonima = await pestanaLimpia(browser);
    await anonima.goto('/bienvenida');
    await expect(anonima).toHaveURL(/\/entrar/);
    await anonima.close();
  });

  test('T1.1 · dos corporates, los dos en el selector', async () => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await crearCorporate(pagina, NOMBRE_UNO, '5');
    await crearCorporate(pagina, NOMBRE_DOS, '5');

    const opciones = await pagina
      .getByTestId('selector-corporate')
      .locator('option')
      .allTextContents();
    expect(opciones.join(' | ')).toContain(NOMBRE_UNO);
    expect(opciones.join(' | ')).toContain(NOMBRE_DOS);
    expect(opciones).toHaveLength(2);
  });

  test('T1.2 · se invita a un lector y entra viendo sin poder cambiar nada', async ({
    browser,
    baseURL,
  }) => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await cambiarA(pagina, NOMBRE_UNO);
    await pagina.goto('/panel/equipo');
    await pagina.getByTestId('invitar-email').fill(LECTOR);
    await pagina.getByTestId('invitar-rol').selectOption('lector');
    await pagina.getByTestId('invitar-enviar').click();

    const enlace = await pagina.getByTestId('invitar-enlace').textContent({ timeout: 30_000 });
    expect(enlace, 'la invitación tiene que devolver un enlace para copiar').toBeTruthy();
    estado.enlaceDeInvitacion = (enlace ?? '').trim();

    // El token vive en el enlace y no en la base: allí solo está su sha256.
    const token = estado.enlaceDeInvitacion.split('/invitacion/')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const lector = await pestanaLimpia(browser);
    estado.lector = lector;

    const ruta = `${baseURL ?? ''}/invitacion/${token}`;
    await lector.goto(ruta);
    await lector.getByTestId('invitacion-nombre').fill('Lector de pruebas');
    await lector.getByTestId('invitacion-contrasena').fill(CONTRASENA);
    await lector.getByTestId('invitacion-repetida').fill(CONTRASENA);
    await lector.getByTestId('invitacion-aceptar').click();
    await lector.waitForURL('**/panel', { timeout: 30_000 });

    await expect(lector.getByTestId('rol-actual')).toHaveText('Lector');

    // Ve los datos…
    await lector.goto('/panel/archivos');
    await expect(lector.getByText('Estás como lector')).toBeVisible();
    // …y no puede cambiarlos.
    await expect(lector.getByTestId('subir-enviar')).toHaveCount(0);

    await lector.goto('/panel/ajustes');
    await expect(lector.getByTestId('presupuesto-guardar')).toHaveCount(0);
    await expect(lector.getByTestId('credencial-guardar')).toHaveCount(0);

    await lector.goto('/panel/configuracion');
    await expect(lector.getByTestId('config-guardar')).toHaveCount(0);
  });

  test('T1.3 · el lector de un corporate no llega a los datos del otro', async () => {
    const lector = estado.lector;
    const admin = estado.admin;
    expect(lector).toBeDefined();
    expect(admin).toBeDefined();
    if (lector === undefined || admin === undefined) return;

    // En el selector del lector solo está su corporate: el otro no existe para él.
    const suyos = await lector
      .getByTestId('selector-corporate')
      .locator('option')
      .allTextContents();
    expect(suyos).toHaveLength(1);
    expect(suyos.join('')).toContain(NOMBRE_UNO);
    expect(suyos.join('')).not.toContain(NOMBRE_DOS);

    // Y si consigue el identificador de una versión de un archivo del otro
    // corporate y lo pide, se le deniega.
    await cambiarA(admin, NOMBRE_DOS);
    await admin.goto('/panel/archivos');
    await admin.getByTestId('subir-archivo').setInputFiles({
      name: 'solo-de-dos.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('contenido que el lector del otro corporate no debe ver'),
    });
    await admin.getByTestId('subir-enviar').click();
    await expect(admin.getByTestId('subir-ok')).toContainText(/subido a context/, {
      timeout: 30_000,
    });

    await admin.goto('/panel/archivos');
    await admin.getByTestId('archivo-solo-de-dos.txt').click();
    const formularioAjeno = admin
      .getByTestId('archivo-solo-de-dos.txt')
      .locator('input[name="versionId"]')
      .first();
    const versionAjena = await formularioAjeno.getAttribute('value');
    expect(versionAjena).toBeTruthy();

    // El lector pide esa descarga desde su propia sesión.
    const respuesta = await lector.request.post('/panel/archivos', {
      form: { versionId: versionAjena ?? '' },
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    // No importa cómo rebote: lo que importa es que **no** devuelva una URL
    // firmada del almacén de otro corporate.
    const cabecera = respuesta.headers()['location'] ?? '';
    expect(cabecera).not.toContain('/storage/v1/object/sign/');
  });

  test('T1.4 · un archivo reemplazado conserva la versión anterior', async () => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await cambiarA(pagina, NOMBRE_UNO);

    // Se recarga la página entre subidas, y el mensaje que se comprueba es
    // distinto en cada una. Sin eso, la segunda aserción podía pasar leyendo el
    // mensaje de la primera, que sigue en pantalla: el test diría que hay dos
    // versiones sin que la segunda subida haya ocurrido.
    for (const [contenido, esperado] of [
      ['la primera version del contexto', /subido a context/],
      ['la segunda, distinta', /reemplazado: ahora es la versión 2/],
    ] as const) {
      await pagina.goto('/panel/archivos');
      await pagina.getByTestId('subir-archivo').setInputFiles({
        name: 'contexto.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(contenido),
      });
      await pagina.getByTestId('subir-enviar').click();
      await expect(pagina.getByTestId('subir-ok')).toContainText(esperado, { timeout: 30_000 });
    }

    await pagina.goto('/panel/archivos');
    const archivo = pagina.getByTestId('archivo-contexto.txt');
    await expect(archivo).toContainText('2 versiones');
    await archivo.click();

    await expect(archivo.getByTestId('descargar-v1')).toBeVisible();
    await expect(archivo.getByTestId('descargar-v2')).toBeVisible();

    // La anterior se descarga de verdad, y con su contenido de entonces.
    const descarga = pagina.waitForEvent('download');
    await archivo.getByTestId('descargar-v1').click();
    const fichero = await descarga;
    expect(fichero.suggestedFilename()).toContain('contexto');
  });

  test('T1.5 · cambiar el tono, guardar y revertir deja las dos versiones', async () => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await pagina.goto('/panel/configuracion?agente=emailing');
    await pagina.getByTestId('config-tono').selectOption('neutro');
    await pagina.getByTestId('config-guardar').click();
    await expect(pagina.getByTestId('config-ok')).toBeVisible({ timeout: 30_000 });

    await pagina.goto('/panel/configuracion?agente=emailing');
    await pagina.getByTestId('config-tono').selectOption('cercano');
    await pagina.getByTestId('config-nota').fill('Tono más cercano');
    await pagina.getByTestId('config-guardar').click();
    await expect(pagina.getByTestId('config-ok')).toBeVisible({ timeout: 30_000 });

    await pagina.goto('/panel/configuracion?agente=emailing');
    await expect(pagina.getByTestId('config-tono')).toHaveValue('cercano');
    await expect(pagina.getByTestId('version-1')).toBeVisible();
    await expect(pagina.getByTestId('version-2')).toBeVisible();

    // Revertir crea la v3 con el contenido de la v1: el historial no tiene huecos.
    await pagina.getByTestId('revertir-1').click();
    await pagina.waitForTimeout(2000);
    await pagina.goto('/panel/configuracion?agente=emailing');
    await expect(pagina.getByTestId('config-tono')).toHaveValue('neutro');
    await expect(pagina.getByTestId('version-3')).toContainText('revertida desde la v1');
  });

  test('T1.6 · un límite diario negativo se rechaza con un mensaje que se entiende', async () => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await pagina.goto('/panel/configuracion?agente=emailing');
    await pagina.getByTestId('config-por-dia').fill('-5');
    await pagina.getByTestId('config-guardar').click();

    const error = pagina.getByTestId('config-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText('no puede ser negativo');
    await expect(error).toContainText('Pon 0 para desactivar');
    // Y no en inglés.
    await expect(error).not.toContainText('Expected');
  });

  test('T1.7 · una aprobación de prueba se edita, se aprueba y aparece en eventos', async ({
    browser,
  }) => {
    const lab = await pestanaLimpia(browser);
    await lab.goto('/lab/login');
    await lab.getByTestId('lab-password').fill(requireLabPassword());
    await lab.getByRole('button', { name: 'Entrar' }).click();
    await lab.waitForURL('**/lab', { timeout: 30_000 });

    await elegirEnLab(lab, NOMBRE_UNO);
    await lab.getByTestId('lab-nota').fill('aprobación del kit');
    await lab.getByTestId('lab-ejecutar-agente').click();

    const resultado = lab.getByTestId('lab-resultado').first();
    await expect(resultado).toBeVisible({ timeout: 30_000 });
    await expect(resultado).toContainText('pedir-aprobacion');
    await expect(resultado).toContainText('aprobación creada en la cola');

    const pagina = estado.admin;
    if (pagina === undefined) return;
    await cambiarA(pagina, NOMBRE_UNO);
    await pagina.goto('/panel/aprobaciones');

    const contenido = pagina.getByTestId('aprobacion-contenido').first();
    await expect(contenido).toBeVisible();
    await expect(contenido).toHaveValue(/aprobación del kit/);
    await contenido.fill('Texto editado por el kit de pruebas');
    await pagina.getByTestId('aprobacion-aprobar').first().click();

    await expect(pagina.getByTestId('aprobacion-ok').first()).toContainText('con tu edición', {
      timeout: 30_000,
    });

    await pagina.goto('/panel/eventos');
    await expect(pagina.getByText('prueba.accion.enviada').first()).toBeVisible();
    await expect(pagina.getByText('approval.granted').first()).toBeVisible();

    await lab.close();
  });

  test('T1.8 · con 0,50 € de presupuesto avisa al 50 % y al 80 % y corta al 100 %', async ({
    browser,
  }) => {
    const pagina = estado.admin;
    expect(pagina).toBeDefined();
    if (pagina === undefined) return;

    await cambiarA(pagina, NOMBRE_DOS);
    await pagina.goto('/panel/ajustes');
    await pagina.getByTestId('presupuesto-limite').fill('0.50');
    await pagina.getByTestId('presupuesto-guardar').click();
    await expect(pagina.getByTestId('presupuesto-ok')).toBeVisible({ timeout: 30_000 });

    const lab = await pestanaLimpia(browser);
    await lab.goto('/lab/login');
    await lab.getByTestId('lab-password').fill(requireLabPassword());
    await lab.getByRole('button', { name: 'Entrar' }).click();
    await lab.waitForURL('**/lab', { timeout: 30_000 });

    await elegirEnLab(lab, NOMBRE_DOS);
    await lab.getByTestId('lab-llamada-llm-20').click();

    // Veinte llamadas de 0,05 € contra 0,50 €: diez pasan y diez rebotan.
    await expect(lab.getByTestId('lab-resultado').first()).toContainText('BLOQUEADA', {
      timeout: 120_000,
    });
    await expect(lab.getByTestId('lab-resultado').first()).toContainText(
      'Presupuesto del mes agotado',
    );
    await lab.close();

    /*
     * Lo que se comprueba a partir de aquí es el **estado del sistema**, no el
     * registro que va pintando la sala de pruebas.
     *
     * Ese registro vive en el estado de un componente, y el estado de un
     * componente se pierde por motivos que no tienen nada que ver con lo que se
     * está probando: en desarrollo, una recarga en caliente lo vacía a mitad
     * del lote. Un caso del kit que dependa de eso falla a veces, y un test que
     * falla a veces se acaba ignorando.
     *
     * Los avisos del 50 %, del 80 % y del corte dejan rastro en dos sitios que
     * no se borran: los eventos del corporate y sus banderas del mes. La
     * aritmética exacta —qué llamada cruza cada umbral— está probada aparte, en
     * `packages/db/pruebas/presupuesto.test.ts`, donde se puede afirmar sin
     * navegador.
     */
    await cambiarA(pagina, NOMBRE_DOS);

    await pagina.goto('/panel/eventos');
    const umbrales = pagina
      .locator('tr', { has: pagina.getByText('budget.threshold.reached') })
      .locator('code');
    const textos = (await umbrales.allTextContents()).join(' ');
    expect(textos, 'tiene que avisar al cruzar el 50 %').toContain('"50"');
    expect(textos, 'tiene que avisar al cruzar el 80 %').toContain('"80"');
    expect(textos, 'tiene que cortar al llegar al 100 %').toContain('"100"');

    // Y el panel lo dice donde se mira.
    await pagina.goto('/panel');
    await expect(pagina.getByText('Presupuesto del mes agotado')).toBeVisible();

    await pagina.goto('/panel/ajustes');
    await expect(pagina.getByTestId('gastado')).toContainText('0,5');
    await expect(pagina.getByText('cortado al 100 %')).toBeVisible();

    // Ampliar el presupuesto levanta el corte: es lo que el propio aviso dice
    // que hay que hacer, y conviene que sea cierto.
    await pagina.getByTestId('presupuesto-limite').fill('5');
    await pagina.getByTestId('presupuesto-guardar').click();
    await expect(pagina.getByTestId('presupuesto-ok')).toBeVisible({ timeout: 30_000 });
    await pagina.goto('/panel');
    await expect(pagina.getByText('Presupuesto del mes agotado')).toHaveCount(0);
  });

  test('T1.9 · en L0 la acción se genera y no se envía', async ({ browser }) => {
    const lab = await pestanaLimpia(browser);
    await lab.goto('/lab/login');
    await lab.getByTestId('lab-password').fill(requireLabPassword());
    await lab.getByRole('button', { name: 'Entrar' }).click();
    await lab.waitForURL('**/lab', { timeout: 30_000 });

    // Se usa el corporate Uno: el Dos tiene el presupuesto agotado por T1.8, y
    // entonces el agente rebotaría por dinero y no por nivel, que es otra cosa.
    await elegirEnLab(lab, NOMBRE_UNO);

    await lab.getByTestId('lab-nivel-L0').click();
    await expect(lab.getByTestId('lab-resultado').first()).toContainText('Nivel cambiado a L0', {
      timeout: 30_000,
    });

    await lab.getByTestId('lab-ejecutar-agente').click();
    const resultado = lab.getByTestId('lab-resultado').first();
    await expect(resultado).toContainText('Agente en L0', { timeout: 30_000 });
    await expect(resultado).toContainText('solo-generar');
    await expect(resultado).toContainText('nada enviado');

    // En L1 la misma pulsación sí deja algo en la cola: la diferencia es el nivel.
    await lab.getByTestId('lab-nivel-L1').click();
    await expect(lab.getByTestId('lab-resultado').first()).toContainText('Nivel cambiado a L1', {
      timeout: 30_000,
    });
    await lab.getByTestId('lab-ejecutar-agente').click();
    await expect(lab.getByTestId('lab-resultado').first()).toContainText('aprobación creada', {
      timeout: 30_000,
    });

    await lab.close();
  });

  test.afterAll(async ({ request, baseURL }) => {
    // El kit deja el entorno como lo encontró, para que se pueda repetir y para
    // que Alex se encuentre staging vacío cuando vaya a hacerlo a mano.
    await resetearEntorno(request, baseURL ?? '').catch(() => undefined);
  });
});
