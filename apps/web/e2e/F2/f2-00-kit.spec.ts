/**
 * Kit de prueba de F2 · casos T2.1 a T2.6, contra staging.
 *
 * Son llamadas reales a los modelos, a través del router, cobradas en el
 * presupuesto de un corporate de prueba que el propio test crea y borra. Una
 * pasada completa cuesta unos céntimos.
 *
 * T2.4 espera a que la Batch API termine el lote, y eso depende de Anthropic:
 * normalmente, unos minutos; en el peor caso, horas. El test espera hasta 25
 * minutos y, si no ha terminado, falla diciendo que el lote sigue en proceso,
 * no que esté mal.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  borrarCorporate,
  crearCorporate,
  probar,
  proximoEnero,
  SELLO_F2,
  type ResultadoDePrueba,
} from '../helpers/f2.ts';
import { labApiContext, labPassword, loginToLab } from '../helpers/lab.ts';

test.describe.configure({ mode: 'serial' });

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-5';

const estado: { tenantId?: string; t22?: ResultadoDePrueba; creados: string[] } = { creados: [] };

/**
 * Un contexto de API para todo el fichero. El `request` de Playwright es de
 * cada test: la cookie de `/lab` que se consigue en `beforeAll` no llegaría a
 * los tests ni a `afterAll`, que es justo quien tiene que limpiar.
 */
const conexion: { contexto?: APIRequestContext } = {};

function api(): APIRequestContext {
  if (conexion.contexto === undefined)
    throw new Error('El contexto de /lab no se ha creado en beforeAll.');
  return conexion.contexto;
}

test.describe('Kit de F2 · librería LLM y prompts', () => {
  test.skip(labPassword === undefined, 'Sin E2E_LAB_PASSWORD no se puede entrar en /lab.');

  test.beforeAll(async ({ playwright, baseURL }) => {
    conexion.contexto = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    await labApiContext(api(), baseURL ?? '');
    estado.tenantId = await crearCorporate(
      api(),
      baseURL ?? '',
      `E2E F2 Modelos Demo ${SELLO_F2}`,
      3,
    );
    estado.creados.push(estado.tenantId);
  });

  test.afterAll(async ({ baseURL }) => {
    for (const id of estado.creados) await borrarCorporate(api(), baseURL ?? '', id);
    await api().dispose();
  });

  test('T2.1 · clasificar «Ahora mismo no, escríbeme en enero»: modelo ligero, NO_AHORA, enero, < 0,001 €', async ({
    baseURL,
  }) => {
    const { status, r } = await probar(api(), baseURL ?? '', {
      modo: 'plantilla',
      tenantId: estado.tenantId,
      plantilla: 'clasificar-respuesta',
      entrada: { respuesta: 'Ahora mismo no, escríbeme en enero' },
    });
    expect(status, JSON.stringify(r)).toBe(200);
    expect(r.estado).toBe('valida');
    expect(r.modelo).toBe(HAIKU);
    expect(r.nivel).toBe('ligero');
    expect(r.datos?.['categoria']).toBe('NO_AHORA');
    expect(String(r.datos?.['fechaRecontacto'])).toMatch(new RegExp(`^${proximoEnero()}`));
    expect(r.costeEur).toBeGreaterThan(0);
    expect(r.costeEur).toBeLessThan(0.001);
  });

  test('T2.2 · redactar un email para un director financiero de una asesoría: modelo medio, con asunto y coste', async ({
    baseURL,
  }) => {
    const { status, r } = await probar(api(), baseURL ?? '', {
      modo: 'plantilla',
      tenantId: estado.tenantId,
      plantilla: 'redactar-email',
      perfil: 'clinica-aurora-demo',
      entrada: { prospecto: { cargo: 'Director financiero', sector: 'Asesoría fiscal y laboral' } },
    });
    expect(status, JSON.stringify(r)).toBe(200);
    expect(r.estado).toBe('valida');
    expect(r.modelo).toBe(SONNET);
    expect(String(r.datos?.['asunto']).length).toBeGreaterThan(3);
    expect(String(r.datos?.['cuerpo'])).toContain('Lucía Fernández');
    expect(r.costeEur).toBeGreaterThan(0);
    estado.t22 = r;
  });

  test('T2.3 · el mismo tenant con otro prospecto acierta en caché y cuesta menos', async ({
    baseURL,
  }) => {
    const { r } = await probar(api(), baseURL ?? '', {
      modo: 'plantilla',
      tenantId: estado.tenantId,
      plantilla: 'redactar-email',
      perfil: 'clinica-aurora-demo',
      entrada: { prospecto: { cargo: 'Directora de personas', sector: 'Tecnología' } },
    });
    expect(r.estado).toBe('valida');
    expect(
      r.cacheAcertada,
      'la segunda llamada con el mismo perfil tiene que leer de la caché',
    ).toBe(true);
    expect(r.uso.cacheLeida).toBeGreaterThan(1000);
    expect(r.costeEur).toBeLessThan(estado.t22?.costeEur ?? 0);
  });

  test('T2.5 · salida malformada: un fallo se corrige en el reintento; dos, se marca sin romper nada', async ({
    baseURL,
  }) => {
    const base = {
      modo: 'plantilla',
      tenantId: estado.tenantId,
      plantilla: 'clasificar-respuesta',
      entrada: { respuesta: 'Dadme de baja' },
    };
    const una = await probar(api(), baseURL ?? '', { ...base, estropear: 1 });
    expect(una.r).toMatchObject({ estado: 'valida', intentos: 2 });
    expect(una.r.datos?.['categoria']).toBe('BAJA');

    const dos = await probar(api(), baseURL ?? '', { ...base, estropear: 2 });
    expect(dos.status, 'marcar una salida inválida no es un error del servidor').toBe(200);
    expect(dos.r).toMatchObject({ estado: 'fallida', intentos: 2 });
    expect(dos.r.errores?.length).toBeGreaterThan(0);
  });

  test('T2.6 · Langfuse tiene la traza separada por tenant y agente, con coste', async ({
    baseURL,
  }) => {
    const trazaId = estado.t22?.trazaId ?? '';
    let traza: {
      existe: boolean;
      tenant?: string;
      agente?: string;
      costeEur?: number;
      generaciones?: number;
    } = {
      existe: false,
    };
    // La ingesta de Langfuse es asíncrona: se espera hasta un minuto.
    await expect
      .poll(
        async () => {
          const respuesta = await api().get(`${baseURL ?? ''}/api/lab/traza?id=${trazaId}`);
          traza = (await respuesta.json()) as typeof traza;
          return traza.existe && (traza.costeEur ?? 0) > 0;
        },
        { timeout: 60_000, intervals: [3_000] },
      )
      .toBe(true);
    expect(traza.tenant).toBe(estado.tenantId);
    expect(traza.agente).toBe('lab-probador');
    expect(traza.generaciones).toBeGreaterThanOrEqual(1);
    expect(traza.costeEur).toBeCloseTo(estado.t22?.costeEur ?? 0, 5);
  });

  test('Presupuesto · con el presupuesto casi agotado, la llamada no se hace y lo explica', async ({
    baseURL,
  }) => {
    // Una clasificación reserva unos 0,0016 € y cuesta unos 0,0008 €: con
    // 0,002 € cabe la primera y la segunda ya no.
    const pobre = await crearCorporate(
      api(),
      baseURL ?? '',
      `E2E F2 Sin Presupuesto Demo ${SELLO_F2}`,
      0.002,
    );
    estado.creados.push(pobre);
    const base = {
      modo: 'plantilla',
      tenantId: pobre,
      plantilla: 'clasificar-respuesta',
      entrada: { respuesta: 'Me interesa, ¿cuándo podemos hablar?' },
    };
    const primera = await probar(api(), baseURL ?? '', base);
    expect(primera.r.estado).toBe('valida');
    const segunda = await probar(api(), baseURL ?? '', base);
    expect(segunda.r).toMatchObject({ estado: 'bloqueada', costeEur: 0 });
    expect(segunda.r.mensaje).toMatch(/quedan .* € libres|agotado/);
  });

  test('Probador en pantalla · enseña modelo elegido, coste y caché', async ({ page }) => {
    await loginToLab(page);
    await page.getByTestId('probador-corporate').selectOption(estado.tenantId ?? '');
    await page.getByTestId('probador-tarea').selectOption('clasificar-respuesta');
    await page.getByTestId('probador-respuesta').fill('Pásame info por email');
    await page.getByTestId('probador-enviar').click();
    await expect(page.getByTestId('probador-resultado')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('probador-modelo')).toHaveAttribute('data-modelo', HAIKU);
    await expect(page.getByTestId('probador-cache')).toBeVisible();
    const coste = Number(await page.getByTestId('probador-coste').getAttribute('data-coste'));
    expect(coste).toBeGreaterThan(0);
    await expect(page.getByTestId('probador-salida')).toContainText('PIDE_INFORMACION');
  });

  test('T2.4 · el lote de 20 respuestas termina, acierta al menos 18 y cuesta la mitad por unidad', async ({
    baseURL,
  }) => {
    test.setTimeout(27 * 60_000);
    const lanzado = await api().post(`${baseURL ?? ''}/api/lab/lote`, {
      data: { tenantId: estado.tenantId },
    });
    const lote = (await lanzado.json()) as { estado: string; loteId?: string; error?: string };
    expect(lote.estado, JSON.stringify(lote)).toBe('creado');

    interface Lote {
      loteId: string;
      terminado: boolean;
      resultado?: {
        aciertos: number;
        total: number;
        coste_por_elemento_eur: number;
        coste_sin_lote_eur: number;
        coste_del_lote_eur: number;
      };
    }
    let encontrado: Lote | undefined;
    await expect
      .poll(
        async () => {
          const respuesta = await api().get(`${baseURL ?? ''}/api/lab/lotes`);
          const { lotes } = (await respuesta.json()) as { lotes: Lote[] };
          encontrado = lotes.find((l) => l.loteId === lote.loteId);
          return encontrado?.terminado ?? false;
        },
        {
          timeout: 25 * 60_000,
          intervals: [20_000],
          message: `El lote ${lote.loteId ?? ''} sigue en proceso en la Batch API: no es un fallo del sistema, repite el caso más tarde.`,
        },
      )
      .toBe(true);

    const r = encontrado?.resultado;
    expect(r?.total).toBe(20);
    expect(r?.aciertos).toBeGreaterThanOrEqual(18);
    // «Aproximadamente la mitad»: el lote cuesta el 50 % del mismo uso fuera de lote.
    const proporcion = (r?.coste_del_lote_eur ?? 0) / (r?.coste_sin_lote_eur ?? 1);
    expect(proporcion).toBeGreaterThan(0.45);
    expect(proporcion).toBeLessThan(0.55);
  });
});
