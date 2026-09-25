import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { PresupuestoEnMemoria } from './presupuesto.ts';
import { ProveedorConFallos, ProveedorSimulado, type Respondedor } from './proveedores/simulado.ts';
import { crearRouter, type PeticionDeGeneracion } from './router.ts';
import { TrazadorEnMemoria, type Trazador } from './trazas.ts';

const TENANT = '00000000-0000-4000-8000-000000000001';
const esquema = z.object({ categoria: z.enum(['INTERESADO', 'BAJA']), resumen: z.string().min(1) });
const BIEN = '{"categoria":"BAJA","resumen":"pide la baja"}';

/** Un bloque fijo por encima del mínimo de caché de Sonnet 5 (1024 tokens). */
const PERFIL_LARGO = `Perfil comercial de un corporate ficticio. ${'Instrucción estable del agente. '.repeat(160)}`;

function montar(
  opciones: {
    responder?: Respondedor;
    limiteEur?: number;
    trazador?: Trazador;
    alAvisar?: (m: string) => void;
  } = {},
) {
  const proveedor = new ProveedorSimulado({ responder: opciones.responder ?? (() => BIEN) });
  const presupuesto = new PresupuestoEnMemoria(opciones.limiteEur ?? 10);
  const trazador = new TrazadorEnMemoria();
  const router = crearRouter({
    proveedor,
    presupuesto,
    trazador: opciones.trazador ?? trazador,
    tipoCambioUsdEur: 0.93,
    ...(opciones.alAvisar === undefined ? {} : { alAvisar: opciones.alAvisar }),
  });
  return { proveedor, presupuesto, trazador, router };
}

function clasificar(overrides: Partial<PeticionDeGeneracion<z.infer<typeof esquema>>> = {}) {
  return {
    tenantId: TENANT,
    agente: 'prueba',
    tarea: 'clasificar-respuesta',
    nivel: 'ligero' as const,
    bloquesFijos: ['Clasifica la respuesta.'],
    mensaje: 'Dadme de baja',
    esquema,
    maxTokens: 200,
    ...overrides,
  };
}

/** La misma petición sin esquema: devuelve texto libre. */
function sinEsquema(
  overrides: Partial<PeticionDeGeneracion<never>> = {},
): PeticionDeGeneracion<never> {
  const { esquema: _sinUso, ...resto } = clasificar();
  return { ...resto, ...overrides };
}

describe('router · elección de modelo y contabilidad (F2.1, F2.5)', () => {
  it('una clasificación usa el modelo ligero, valida, y apunta su coste al tenant y al agente', async () => {
    const { router, presupuesto, proveedor } = montar();
    const r = await router.generar(clasificar());

    expect(r.estado).toBe('valida');
    expect(r.modelo).toBe('claude-haiku-4-5-20251001');
    expect(proveedor.recibidas[0]?.modelo.id).toBe('claude-haiku-4-5-20251001');
    if (r.estado === 'valida') expect(r.datos.categoria).toBe('BAJA');

    expect(presupuesto.apuntes).toHaveLength(1);
    expect(presupuesto.apuntes[0]).toMatchObject({
      tenantId: TENANT,
      agente: 'prueba',
      modo: 'directo',
    });
    expect(presupuesto.apuntes[0]?.costeEur).toBe(r.costeEur);
    expect(r.costeEur).toBeGreaterThan(0);
    expect(presupuesto.reservadoEur).toBe(0);
  });

  it('traza cada llamada con su tenant, su agente y su coste', async () => {
    const { router, trazador } = montar();
    const r = await router.generar(clasificar());
    expect(trazador.trazas).toHaveLength(1);
    expect(trazador.trazas[0]).toMatchObject({
      id: r.trazaId,
      tenantId: TENANT,
      agente: 'prueba',
      resultado: 'valida',
      costeEur: r.costeEur,
    });
  });

  it('una petición sin tenant es un error de programación y no llega al proveedor', async () => {
    const { router, proveedor } = montar();
    await expect(router.generar(clasificar({ tenantId: ' ' }))).rejects.toThrow(/tenant/);
    expect(proveedor.recibidas).toHaveLength(0);
  });
});

describe('router · caché del bloque fijo (F2.2)', () => {
  it('la segunda llamada con el mismo perfil y otro prospecto acierta en caché y cuesta menos (T2.3)', async () => {
    const { router } = montar({ responder: () => 'Asunto: hola\n\nCuerpo.' });
    const base = {
      tenantId: TENANT,
      agente: 'prueba',
      tarea: 'redactar-email',
      nivel: 'medio' as const,
      bloquesFijos: ['Redacta un email.', PERFIL_LARGO],
      maxTokens: 400,
    };

    const primera = await router.generar({
      ...base,
      mensaje: 'Prospecto: directora financiera de una asesoría.',
    });
    const segunda = await router.generar({
      ...base,
      mensaje: 'Prospecto: director de operaciones de una consultora.',
    });

    expect(primera.cacheAcertada).toBe(false);
    expect(primera.uso.cacheEscrita).toBeGreaterThan(0);
    expect(segunda.cacheAcertada).toBe(true);
    expect(segunda.costeEur).toBeLessThan(primera.costeEur);
    expect(primera.avisoDeCache).toBeUndefined();
  });

  it('solo se marca para cachear el último bloque fijo; lo que cambia va en el mensaje', async () => {
    const { router, proveedor } = montar({ responder: () => 'texto' });
    await router.generar(sinEsquema({ bloquesFijos: ['a', 'b', 'c'] }));
    expect(proveedor.recibidas[0]?.sistema.map((b) => b.cachear)).toEqual([false, false, true]);
    expect(proveedor.recibidas[0]?.mensajes[0]?.texto).toBe('Dadme de baja');
  });

  it('avisa cuando el bloque fijo no llega al mínimo de caché del modelo', async () => {
    const { router } = montar();
    const r = await router.generar(clasificar());
    expect(r.avisoDeCache).toMatch(/no llega al mínimo de caché/);
  });

  it('si cambia un carácter del bloque fijo, no hay acierto', async () => {
    const { router } = montar({ responder: () => 'x' });
    const base = {
      tenantId: TENANT,
      agente: 'prueba',
      tarea: 't',
      nivel: 'medio' as const,
      mensaje: 'm',
      maxTokens: 50,
    };
    await router.generar({ ...base, bloquesFijos: [PERFIL_LARGO] });
    const r = await router.generar({ ...base, bloquesFijos: [`${PERFIL_LARGO}.`] });
    expect(r.cacheAcertada).toBe(false);
  });
});

describe('router · salidas validadas con un único reintento (F2.4)', () => {
  it('una salida malformada se reintenta una vez con los errores, y si la corrige, vale', async () => {
    const { router, proveedor, presupuesto } = montar({
      responder: (_p, n) => (n === 1 ? '{"categoria":"QUIZA"}' : BIEN),
    });
    const r = await router.generar(clasificar());

    expect(r.estado).toBe('valida');
    expect(r.intentos).toBe(2);
    const reintento = proveedor.recibidas[1];
    expect(reintento?.mensajes.map((m) => m.rol)).toEqual(['usuario', 'asistente', 'usuario']);
    expect(reintento?.mensajes[2]?.texto).toMatch(/categoria/);
    // El reintento es otra llamada y se cobra: dos apuntes.
    expect(presupuesto.apuntes).toHaveLength(2);
    expect(r.costeEur).toBeCloseTo(presupuesto.gastadoEur, 6);
  });

  it('si falla dos veces, se marca como fallida sin lanzar y sin un tercer intento (T2.5)', async () => {
    const { router, proveedor, trazador } = montar({ responder: () => 'no es json' });
    const r = await router.generar(clasificar());

    expect(r.estado).toBe('fallida');
    if (r.estado === 'fallida') expect(r.errores[0]).toMatch(/No es JSON/);
    expect(proveedor.recibidas).toHaveLength(2);
    expect(trazador.trazas[0]?.resultado).toBe('fallida');
    expect(trazador.trazas[0]?.intentos.every((i) => i.errores !== undefined)).toBe(true);
  });

  it('sin esquema devuelve el texto tal cual y no reintenta', async () => {
    const { router, proveedor } = montar({ responder: () => 'hola' });
    const r = await router.generar(sinEsquema());
    expect(r).toMatchObject({ estado: 'texto', texto: 'hola', intentos: 1 });
    expect(proveedor.recibidas).toHaveLength(1);
  });

  it('con el proveedor estropeado a propósito una vez, el reintento lo arregla; dos veces, queda marcada', async () => {
    for (const [fallos, esperado] of [
      [1, 'valida'],
      [2, 'fallida'],
    ] as const) {
      const real = new ProveedorSimulado({ responder: () => BIEN });
      const router = crearRouter({
        proveedor: new ProveedorConFallos(real, fallos),
        presupuesto: new PresupuestoEnMemoria(10),
        tipoCambioUsdEur: 0.93,
      });
      const r = await router.generar(clasificar());
      expect(r.estado).toBe(esperado);
      expect(r.intentos).toBe(2);
    }
  });
});

describe('router · el presupuesto corta de verdad (F1.13 + F2.5)', () => {
  it('un tenant sin presupuesto no llega al proveedor', async () => {
    const { router, proveedor } = montar({ limiteEur: 0 });
    const r = await router.generar(clasificar());
    expect(r).toMatchObject({ estado: 'bloqueada', motivo: 'sin_presupuesto', costeEur: 0 });
    expect(proveedor.recibidas).toHaveLength(0);
  });

  it('si el coste máximo de la llamada no cabe en lo que queda, no se hace', async () => {
    const { router, proveedor } = montar({ limiteEur: 0.0001 });
    const r = await router.generar(clasificar({ maxTokens: 4000 }));
    expect(r).toMatchObject({ estado: 'bloqueada', motivo: 'presupuesto_insuficiente' });
    expect(proveedor.recibidas).toHaveLength(0);
  });

  it('en una serie de llamadas, el gasto nunca supera el límite', async () => {
    // El coste máximo de cada llamada (200 tokens de salida) ronda 0,00093 €,
    // así que con 0,002 € caben unas pocas y el resto tiene que rebotar.
    const limite = 0.002;
    const { router, presupuesto } = montar({ limiteEur: limite });
    let bloqueadas = 0;
    for (let i = 0; i < 100; i++) {
      const r = await router.generar(clasificar());
      if (r.estado === 'bloqueada') bloqueadas++;
    }
    expect(bloqueadas).toBeGreaterThan(0);
    expect(presupuesto.gastadoEur).toBeLessThanOrEqual(limite);
  });

  it('si el presupuesto se agota entre el intento y el reintento, se para y lo dice', async () => {
    const { router, proveedor } = montar({ responder: () => 'mal', limiteEur: 0.000945 });
    const r = await router.generar(clasificar());
    expect(proveedor.recibidas).toHaveLength(1);
    expect(r).toMatchObject({ estado: 'bloqueada', intentos: 1 });
  });

  it('si el proveedor falla, la reserva se libera y no se lanza', async () => {
    const presupuesto = new PresupuestoEnMemoria(10);
    const router = crearRouter({
      proveedor: { id: 'roto', generar: () => Promise.reject(new Error('503')) },
      presupuesto,
      tipoCambioUsdEur: 0.93,
    });
    const r = await router.generar(clasificar());
    expect(r).toMatchObject({ estado: 'error', costeEur: 0 });
    if (r.estado === 'error') expect(r.mensaje).toMatch(/503/);
    expect(presupuesto.reservadoEur).toBe(0);
    expect(presupuesto.apuntes[0]?.costeEur).toBe(0);
  });
});

describe('router · una traza que falla no rompe la llamada', () => {
  it('devuelve el resultado y avisa', async () => {
    const alAvisar = vi.fn();
    const { router } = montar({
      trazador: { registrar: () => Promise.reject(new Error('Langfuse caído')) },
      alAvisar,
    });
    const r = await router.generar(clasificar());
    expect(r.estado).toBe('valida');
    expect(alAvisar).toHaveBeenCalledOnce();
  });
});

describe('router · modo lote (F2.3)', () => {
  const elementos = Array.from({ length: 5 }, (_, i) => ({
    id: `r${String(i)}`,
    mensaje: `respuesta ${String(i)}`,
  }));
  const lote = {
    tenantId: TENANT,
    agente: 'prueba',
    tarea: 'clasificar-respuesta',
    nivel: 'ligero' as const,
    bloquesFijos: ['Clasifica.'],
    esquema,
    maxTokens: 200,
    elementos,
  };

  it('reserva, espera a que termine, valida cada elemento y cobra la mitad', async () => {
    const { router, presupuesto } = montar();
    const creado = await router.crearLote(lote);
    expect(creado.estado).toBe('creado');
    if (creado.estado !== 'creado') return;
    expect(presupuesto.reservadoEur).toBeGreaterThan(0);

    const primera = await router.recogerLote({
      ...lote,
      loteId: creado.loteId,
      reservaId: creado.reservaId,
    });
    expect(primera.estado).toBe('en-proceso');

    const final = await router.recogerLote({
      ...lote,
      loteId: creado.loteId,
      reservaId: creado.reservaId,
    });
    expect(final.estado).toBe('terminado');
    if (final.estado !== 'terminado') return;
    expect(final.resultados).toHaveLength(5);
    expect(final.resultados.every((r) => r.estado === 'valida')).toBe(true);
    expect(final.costeDelLoteEur).toBeCloseTo(final.costeSinLoteEur / 2, 5);
    expect(presupuesto.reservadoEur).toBe(0);
    expect(presupuesto.apuntes).toHaveLength(1);
    expect(presupuesto.apuntes[0]?.modo).toBe('lote');
  });

  it('un elemento que no valida se reintenta una vez fuera del lote', async () => {
    let llamadas = 0;
    const { router, presupuesto } = montar({
      responder: (p) => {
        llamadas++;
        return p.mensajes[0]?.texto === 'respuesta 2' && llamadas <= 5 ? 'roto' : BIEN;
      },
    });
    const creado = await router.crearLote(lote);
    if (creado.estado !== 'creado') throw new Error('no creado');
    await router.recogerLote({ ...lote, loteId: creado.loteId, reservaId: creado.reservaId });
    const final = await router.recogerLote({
      ...lote,
      loteId: creado.loteId,
      reservaId: creado.reservaId,
    });
    if (final.estado !== 'terminado') throw new Error('no terminado');

    expect(final.resultados.find((r) => r.id === 'r2')).toMatchObject({
      estado: 'valida',
      reintentado: true,
    });
    expect(final.costeDeReintentosEur).toBeGreaterThan(0);
    expect(presupuesto.apuntes.map((a) => a.modo)).toEqual(['lote', 'directo']);
  });

  it('un lote que no cabe en el presupuesto no se envía', async () => {
    const { router, proveedor } = montar({ limiteEur: 0.00001 });
    const creado = await router.crearLote(lote);
    expect(creado).toMatchObject({ estado: 'bloqueada' });
    expect(proveedor.recibidas).toHaveLength(0);
  });
});
