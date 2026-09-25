/**
 * Presupuesto: avisos al 50 % y al 80 %, corte al 100 % (F1.13, caso T1.8).
 *
 * El caso del kit es literal: presupuesto a 0,50 €, veinte llamadas de prueba,
 * avisos al 50 % y al 80 % y bloqueo al 100 % con un mensaje claro. Con un
 * coste de 0,05 € por llamada, la quinta cruza el 50 %, la octava el 80 % y la
 * décima agota; de la once a la veinte tienen que rebotar.
 *
 * Se prueba contra la base y no contra el servicio de TypeScript porque el
 * corte tiene que sobrevivir a la concurrencia: dos funciones de Inngest
 * cobrando a la vez sobre el mismo tenant. Eso lo resuelve el `for update` de
 * `app.cobrar_llamada`, no el código que la llama.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

const COSTE_DE_PRUEBA = 0.05;

interface Cobro {
  permitida: boolean;
  motivo: string;
  mensaje?: string;
  limite_eur: string | number;
  gastado_eur: string | number;
  porcentaje?: string | number | null;
  umbrales_cruzados?: string[];
}

let db: BaseDePruebas;
let ana: string;
let tenant: string;

async function cobrar(coste = COSTE_DE_PRUEBA): Promise<Cobro> {
  const filas = await db.comoUsuario<{ r: Cobro }>(
    ana,
    `select app.cobrar_llamada($1, $2::numeric, 'prueba', 'llm', 'modelo-ligero', 100, 50) as r`,
    [tenant, coste],
  );
  const resultado = filas[0]?.r;
  if (resultado === undefined) throw new Error('cobrar_llamada no devolvió nada');
  return resultado;
}

beforeAll(async () => {
  db = await levantarBaseDePruebas();
  ana = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  tenant = await db.crearTenant(ana, 'Corporate Uno Demo', 'uno-demo', 0.5);
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('T1.8 · avisos y corte', () => {
  it('las veinte llamadas cruzan los umbrales donde tienen que cruzarlos', async () => {
    const umbralesPorLlamada: Record<number, readonly string[]> = {};
    const rechazadas: number[] = [];

    for (let llamada = 1; llamada <= 20; llamada += 1) {
      const resultado = await cobrar();
      if (!resultado.permitida) {
        rechazadas.push(llamada);
        expect(resultado.motivo, `llamada ${String(llamada)}`).toBe('presupuesto_agotado');
        // «Se bloquea con un mensaje claro»: que diga cuánto y dónde ampliarlo.
        expect(resultado.mensaje).toMatch(/Presupuesto del mes agotado/);
        expect(resultado.mensaje).toMatch(/Ajustes/);
        continue;
      }
      const umbrales = resultado.umbrales_cruzados ?? [];
      if (umbrales.length > 0) umbralesPorLlamada[llamada] = umbrales;
    }

    expect(umbralesPorLlamada).toEqual({ 5: ['50'], 8: ['80'], 10: ['100'] });
    expect(rechazadas).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('el gasto acumulado es exactamente el de las diez llamadas que pasaron', async () => {
    const filas = await db.comoUsuario<{ g: string }>(
      ana,
      'select app.gasto_del_mes($1)::text as g',
      [tenant],
    );
    expect(Number(filas[0]?.g)).toBeCloseTo(0.5, 6);
  });

  it('el libro de gasto tiene diez apuntes y ninguno de los rechazos', async () => {
    const filas = await db.comoUsuario<{ n: string }>(
      ana,
      'select count(*)::text as n from public.spend_ledger where tenant_id = $1',
      [tenant],
    );
    expect(Number(filas[0]?.n)).toBe(10);
  });

  it('queda registrado en eventos, que es lo que ve el visor y lee el Copiloto', async () => {
    const filas = await db.comoUsuario<{ umbrales: string }>(
      ana,
      `select coalesce(datos->>'umbrales', '["' || (datos->>'umbral') || '"]') as umbrales
       from public.events
       where tenant_id = $1 and nombre = 'budget.threshold.reached'
       order by creado_en`,
      [tenant],
    );
    expect(filas.map((f) => f.umbrales)).toEqual(['["50"]', '["80"]', '["100"]']);
  });

  it('las banderas del mes quedan puestas y el mes queda cortado', async () => {
    const filas = await db.comoUsuario<{
      avisado_50: boolean;
      avisado_80: boolean;
      cortado: boolean;
    }>(
      ana,
      'select avisado_50, avisado_80, cortado from public.tenant_budgets where tenant_id = $1',
      [tenant],
    );
    expect(filas[0]).toEqual({ avisado_50: true, avisado_80: true, cortado: true });
  });

  it('ampliar el presupuesto vuelve a permitir llamadas', async () => {
    await db.comoUsuario(
      ana,
      'update public.tenant_budgets set limite_eur = 2 where tenant_id = $1',
      [tenant],
    );
    const resultado = await cobrar();
    expect(resultado.permitida).toBe(true);
    expect(Number(resultado.porcentaje)).toBeCloseTo(27.5, 1);
  });
});

describe('un tenant sin presupuesto no ejecuta llamadas LLM (F1.13)', () => {
  it('con el límite a cero lo dice así, y no como "agotado"', async () => {
    const otro = await db.crearTenant(ana, 'Corporate Tres Demo', 'tres-demo', 0);
    const filas = await db.comoUsuario<{ r: Cobro }>(
      ana,
      `select app.cobrar_llamada($1, 0.01::numeric, 'prueba') as r`,
      [otro],
    );
    expect(filas[0]?.r.permitida).toBe(false);
    expect(filas[0]?.r.motivo).toBe('sin_presupuesto');
    expect(filas[0]?.r.mensaje).toMatch(/presupuesto del mes a 0/i);
  });

  it('sin fila del mes tampoco, y eso es el caso de un mes que nadie ha abierto', async () => {
    const otro = await db.crearTenant(ana, 'Corporate Cuatro Demo', 'cuatro-demo', 5);
    await db.crudo('delete from public.tenant_budgets where tenant_id = $1', [otro]);

    const filas = await db.comoUsuario<{ r: Cobro }>(
      ana,
      `select app.cobrar_llamada($1, 0.01::numeric, 'prueba') as r`,
      [otro],
    );
    expect(filas[0]?.r.permitida).toBe(false);
    expect(filas[0]?.r.motivo).toBe('sin_presupuesto');
  });

  it('cobrar en el presupuesto de otro corporate no escribe nada y no revela nada', async () => {
    const marta = await db.crearUsuario('marta@ejemplo.test', 'Marta');
    const suyo = await db.crearTenant(marta, 'Corporate Cinco Demo', 'cinco-demo', 10);

    const filas = await db.comoUsuario<{ r: Cobro }>(
      ana,
      `select app.cobrar_llamada($1, 0.01::numeric, 'prueba') as r`,
      [suyo],
    );

    // Falla cerrado, y da la misma respuesta que daría un corporate que no
    // existe: RLS esconde la fila del presupuesto, así que la función no puede
    // distinguir «no tiene» de «no te lo puedo enseñar». Esa indistinción es la
    // que evita usar esta función para averiguar si un corporate tiene saldo.
    expect(filas[0]?.r.permitida).toBe(false);
    expect(filas[0]?.r.motivo).toBe('sin_presupuesto');

    const apuntes = await db.crudo<{ n: string }>(
      'select count(*)::text as n from public.spend_ledger where tenant_id = $1',
      [suyo],
    );
    expect(Number(apuntes[0]?.n), 'se ha escrito un apunte en el corporate ajeno').toBe(0);
  });

  it('un coste negativo no es un apunte', async () => {
    await expect(
      db.comoUsuario(ana, `select app.cobrar_llamada($1, -1::numeric, 'prueba')`, [tenant]),
    ).rejects.toThrow(/coste negativo/);
  });
});

describe('F1.13 · un editor también cobra (arreglo de la migración 0010)', () => {
  it('cobrar_llamada con la sesión de un editor encuentra el presupuesto y lo descuenta', async () => {
    const eva = await db.crearUsuario('eva.editora@ejemplo.test', 'Eva');
    const otro = await db.crearTenant(ana, 'Corporate Editora Demo', 'editora-demo', 1);
    await db.anadirMiembro(otro, eva, 'editor');
    const filas = await db.comoUsuario<{ r: Cobro }>(
      eva,
      `select app.cobrar_llamada($1, 0.05::numeric, 'prueba', 'llm', 'modelo-ligero', 100, 50) as r`,
      [otro],
    );
    // Antes de 0010, el `for update` bajo RLS no veía la fila para un editor y
    // respondía «sin presupuesto».
    expect(filas[0]?.r).toMatchObject({ permitida: true });
  });
});
