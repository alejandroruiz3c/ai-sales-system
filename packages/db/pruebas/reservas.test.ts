/**
 * Reservas de gasto (F2.5): el presupuesto corta **antes** de llamar.
 *
 * Contra Postgres de verdad, porque la regla y la serialización viven en la
 * base (`app.autorizar_gasto`, `app.liquidar_gasto`), y porque el último bloque
 * conecta el router de `@sales-os/llm` al presupuesto real: es la prueba de que
 * «el presupuesto de F1.13 corta de verdad» con llamadas a modelo, y no solo
 * con la llamada de prueba de 0,05 €.
 */

import { crearRouter, ProveedorSimulado } from '@sales-os/llm';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  crearPresupuestoDeGasto,
  type ConsultaSql,
  type Ejecutor,
} from '../src/presupuesto-de-gasto.ts';
import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

interface Autorizacion {
  permitida: boolean;
  motivo: string;
  mensaje?: string;
  reserva_id?: string;
}

let db: BaseDePruebas;
let ana: string;
let eva: string;
let intrusa: string;

async function tenantConLimite(nombre: string, limite: number): Promise<string> {
  const slug = `${nombre.toLowerCase().replace(/\s+/g, '-')}-demo`;
  return db.crearTenant(ana, `${nombre} Demo`, slug, limite);
}

async function autorizar(tenant: string, importe: number, usuario = ana): Promise<Autorizacion> {
  const filas = await db.comoUsuario<{ r: Autorizacion }>(
    usuario,
    `select app.autorizar_gasto($1, $2::numeric, 'prueba', 'test', 900) as r`,
    [tenant, importe],
  );
  const r = filas[0]?.r;
  if (r === undefined) throw new Error('autorizar_gasto no devolvió nada');
  return r;
}

async function liquidar(
  reserva: string,
  coste: number,
  usuario = ana,
  extra: { leidos?: number; modo?: string } = {},
): Promise<{ apunte_id: string | null; umbrales_cruzados: string[] }> {
  const filas = await db.comoUsuario<{
    r: { apunte_id: string | null; umbrales_cruzados: string[] };
  }>(
    usuario,
    `select app.liquidar_gasto($1, $2::numeric, 'modelo-ligero', 100, 20, $3::integer, 0, $4::boolean, $5, 'test') as r`,
    [reserva, coste, extra.leidos ?? 0, (extra.leidos ?? 0) > 0, extra.modo ?? 'directo'],
  );
  const r = filas[0]?.r;
  if (r === undefined) throw new Error('liquidar_gasto no devolvió nada');
  return r;
}

async function reservaDe(tenant: string, importe: number): Promise<string> {
  const r = await autorizar(tenant, importe);
  if (!r.permitida || r.reserva_id === undefined)
    throw new Error(`No se pudo reservar: ${String(r.mensaje)}`);
  return r.reserva_id;
}

beforeAll(async () => {
  db = await levantarBaseDePruebas();
  ana = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  eva = await db.crearUsuario('eva@ejemplo.test', 'Eva');
  intrusa = await db.crearUsuario('intrusa@ejemplo.test', 'Intrusa');
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('autorizar_gasto', () => {
  it('sin presupuesto, no reserva', async () => {
    const tenant = await tenantConLimite('Sin Limite', 0);
    expect(await autorizar(tenant, 0.001)).toMatchObject({
      permitida: false,
      motivo: 'sin_presupuesto',
    });
  });

  it('las reservas vivas cuentan contra el límite: la que no cabe se rechaza y lo explica', async () => {
    const tenant = await tenantConLimite('Reservas Vivas', 1);
    await reservaDe(tenant, 0.6);
    const segunda = await autorizar(tenant, 0.5);
    expect(segunda).toMatchObject({ permitida: false, motivo: 'presupuesto_insuficiente' });
    expect(segunda.mensaje).toMatch(/reservados por llamadas en curso/);
    expect(await autorizar(tenant, 0.4)).toMatchObject({ permitida: true });
  });

  it('una reserva caducada deja de contar (un proceso que murió no bloquea el presupuesto)', async () => {
    const tenant = await tenantConLimite('Caducadas', 1);
    await db.crudo(
      `insert into public.spend_reservations (tenant_id, agente, importe_eur, caduca_en, creado_en)
       values ($1, 'prueba', 0.9, now() - interval '1 minute', now() - interval '1 hour')`,
      [tenant],
    );
    expect(await autorizar(tenant, 0.5)).toMatchObject({ permitida: true });
  });

  it('un corporate ajeno no puede reservar en el presupuesto de otro', async () => {
    const tenant = await tenantConLimite('Ajeno', 5);
    // Sin pertenencia, RLS no le deja ver la fila del presupuesto: para ella no
    // hay presupuesto, y no se crea ninguna reserva.
    expect(await autorizar(tenant, 0.1, intrusa)).toMatchObject({
      permitida: false,
      motivo: 'sin_presupuesto',
    });
    const reservas = await db.crudo<{ n: number }>(
      'select count(*)::int as n from public.spend_reservations where tenant_id = $1',
      [tenant],
    );
    expect(reservas[0]?.n).toBe(0);
  });
});

describe('liquidar_gasto', () => {
  it('apunta el coste real con la caché y el modo, y libera la reserva', async () => {
    const tenant = await tenantConLimite('Liquidar', 1);
    const reserva = await reservaDe(tenant, 0.9);
    const r = await liquidar(reserva, 0.02, ana, { leidos: 3000, modo: 'lote' });

    const apunte = await db.crudo<{
      coste_eur: string;
      tokens_cache_leidos: number;
      modo: string;
      cache_acertada: boolean;
    }>(
      'select coste_eur, tokens_cache_leidos, modo, cache_acertada from public.spend_ledger where id = $1',
      [r.apunte_id],
    );
    expect(apunte[0]).toMatchObject({
      coste_eur: '0.020000',
      tokens_cache_leidos: 3000,
      modo: 'lote',
      cache_acertada: true,
    });
    // La reserva de 0,90 ya no cuenta: cabe otra casi del mismo tamaño.
    expect(await autorizar(tenant, 0.95)).toMatchObject({ permitida: true });
  });

  it('una reserva no se liquida dos veces', async () => {
    const tenant = await tenantConLimite('Doble', 1);
    const reserva = await reservaDe(tenant, 0.1);
    await liquidar(reserva, 0.01);
    await expect(liquidar(reserva, 0.01)).rejects.toThrow(/ya se liquidó/);
  });

  it('una llamada fallida sin consumo libera la reserva sin apuntar nada', async () => {
    const tenant = await tenantConLimite('Fallida', 1);
    const reserva = await reservaDe(tenant, 0.5);
    const filas = await db.comoUsuario<{ r: { apunte_id: string | null } }>(
      ana,
      `select app.liquidar_gasto($1, 0, 'modelo', 0, 0, 0, 0, false, 'directo', 'fallida') as r`,
      [reserva],
    );
    expect(filas[0]?.r.apunte_id).toBeNull();
    const apuntes = await db.crudo<{ n: number }>(
      'select count(*)::int as n from public.spend_ledger where tenant_id = $1',
      [tenant],
    );
    expect(apuntes[0]?.n).toBe(0);
  });

  it('nadie liquida una reserva de un corporate del que no es miembro', async () => {
    const tenant = await tenantConLimite('Reserva Ajena', 1);
    const reserva = await reservaDe(tenant, 0.1);
    await expect(liquidar(reserva, 0.01, intrusa)).rejects.toThrow(
      /no existe o no es de un corporate tuyo/,
    );
  });

  it('cruza los avisos del 50 % y del 80 % y publica el evento', async () => {
    const tenant = await tenantConLimite('Umbrales', 1);
    expect((await liquidar(await reservaDe(tenant, 0.6), 0.6)).umbrales_cruzados).toEqual(['50']);
    expect((await liquidar(await reservaDe(tenant, 0.3), 0.3)).umbrales_cruzados).toEqual(['80']);
    const eventos = await db.crudo<{ n: number }>(
      `select count(*)::int as n from public.events where tenant_id = $1 and nombre = 'budget.threshold.reached'`,
      [tenant],
    );
    expect(eventos[0]?.n).toBe(2);
  });

  it('agotado el presupuesto, la siguiente autorización se rechaza y queda anotado el corte', async () => {
    const tenant = await tenantConLimite('Agotado', 0.1);
    expect((await liquidar(await reservaDe(tenant, 0.1), 0.1)).umbrales_cruzados).toEqual([
      '50',
      '80',
      '100',
    ]);
    expect(await autorizar(tenant, 0.0001)).toMatchObject({
      permitida: false,
      motivo: 'presupuesto_agotado',
    });
    const presupuesto = await db.crudo<{ cortado: boolean }>(
      'select cortado from public.tenant_budgets where tenant_id = $1',
      [tenant],
    );
    expect(presupuesto[0]?.cortado).toBe(true);
  });

  it('un editor, que no puede cambiar el presupuesto, también deja anotados los avisos', async () => {
    const tenant = await tenantConLimite('Editora', 1);
    await db.anadirMiembro(tenant, eva, 'editor');
    const autorizacion = await autorizar(tenant, 0.6, eva);
    expect(autorizacion).toMatchObject({ permitida: true });
    const reserva = autorizacion.reserva_id ?? '';
    expect((await liquidar(reserva, 0.6, eva)).umbrales_cruzados).toEqual(['50']);
  });
});

describe('cruzar_umbrales no se puede usar para falsear el estado', () => {
  it('un no miembro no puede llamarla', async () => {
    const tenant = await tenantConLimite('Falsear', 1);
    await expect(
      db.comoUsuario(intrusa, `select app.cruzar_umbrales($1, date_trunc('month', now())::date)`, [
        tenant,
      ]),
    ).rejects.toThrow(/Solo un miembro/);
  });

  it('un miembro que la llama sin haber gastado no marca nada: calcula el gasto, no lo recibe', async () => {
    const tenant = await tenantConLimite('Sin Gasto', 1);
    const filas = await db.comoUsuario<{ u: string[] }>(
      ana,
      `select app.cruzar_umbrales($1, date_trunc('month', now())::date) as u`,
      [tenant],
    );
    expect(filas[0]?.u).toEqual([]);
  });
});

describe('el router de @sales-os/llm con el presupuesto real', () => {
  it('en una serie de llamadas, corta antes de pasarse, y no deja reservas colgadas', async () => {
    // Cada llamada reserva unos 0,00093 € (200 tokens de salida) y gasta unos
    // 0,000025 €: con 0,0012 € caben unas once y el resto tiene que rebotar.
    const limite = 0.0012;
    const tenant = await tenantConLimite('Router', limite);
    const ejecutar: Ejecutor = <T>(fn: (ctx: ConsultaSql) => Promise<T>) =>
      fn({
        consultar: <R>(sql: string, params?: readonly unknown[]) =>
          db.comoSistema<R>(sql, params ? [...params] : []),
        unaFila: async <R>(sql: string, params?: readonly unknown[]) =>
          (await db.comoSistema<R>(sql, params ? [...params] : []))[0],
      });
    const proveedor = new ProveedorSimulado({ responder: () => '{"ok":true}' });
    const router = crearRouter({
      proveedor,
      presupuesto: crearPresupuestoDeGasto(ejecutar),
      tipoCambioUsdEur: 0.93,
    });

    const estados: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await router.generar({
        tenantId: tenant,
        agente: 'prueba',
        tarea: 'clasificar',
        nivel: 'ligero',
        bloquesFijos: ['Clasifica.'],
        mensaje: `respuesta ${String(i)}`,
        esquema: z.object({ ok: z.boolean() }),
        maxTokens: 200,
      });
      estados.push(r.estado);
    }

    const [gasto] = await db.crudo<{ gastado: string; apuntes: number; vivas: number }>(
      `select app.gasto_del_mes($1)::text as gastado,
              (select count(*)::int from public.spend_ledger where tenant_id = $1) as apuntes,
              (select count(*)::int from public.spend_reservations where tenant_id = $1 and liquidada_en is null) as vivas`,
      [tenant],
    );
    expect(estados).toContain('valida');
    expect(estados.at(-1)).toBe('bloqueada');
    expect(Number(gasto?.gastado)).toBeLessThanOrEqual(limite);
    expect(gasto?.apuntes).toBe(estados.filter((e) => e === 'valida').length);
    expect(gasto?.vivas).toBe(0);
    // Las bloqueadas no llegaron al proveedor.
    expect(proveedor.recibidas).toHaveLength(gasto?.apuntes ?? -1);
  });
});
