/**
 * Configuración versionada y nivel de autonomía (F1.8, F1.12, casos T1.5 y T1.6).
 *
 * Lo que se prueba es que el historial no tiene huecos: guardar crea una
 * versión, revertir crea otra que apunta a la que copia, y ninguna de las tres
 * se puede reescribir después. Un tenant que pregunte «¿con qué instrucciones
 * se escribió este email de hace tres semanas?» tiene derecho a una respuesta
 * exacta, y eso solo se sostiene si nada se sobrescribe.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

let db: BaseDePruebas;
let ana: string;
let tenant: string;

async function guardar(
  config: Record<string, unknown>,
  nivel = 'L1',
  nota?: string,
  revertidaDe?: number,
): Promise<number> {
  const filas = await db.comoUsuario<{ version: number }>(
    ana,
    `insert into public.agent_configs (tenant_id, agente, config, nivel_autonomia, nota, revertida_de)
     values ($1, 'prueba', $2::text::jsonb, $3, $4, $5) returning version`,
    [tenant, JSON.stringify(config), nivel, nota ?? null, revertidaDe ?? null],
  );
  const version = filas[0]?.version;
  if (version === undefined) throw new Error('No se guardó la versión');
  return version;
}

beforeAll(async () => {
  db = await levantarBaseDePruebas();
  ana = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  tenant = await db.crearTenant(ana, 'Corporate Uno Demo', 'uno-demo');
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('T1.5 · guardar crea versión y revertir también', () => {
  it('la versión la numera la base, no el cliente', async () => {
    expect(await guardar({ tono: 'neutro' })).toBe(1);
    expect(await guardar({ tono: 'cercano' })).toBe(2);
  });

  it('la configuración vigente es la última', async () => {
    const filas = await db.comoUsuario<{ config: { tono: string }; version: number }>(
      ana,
      `select config, version from public.agent_configs_vigentes
       where tenant_id = $1 and agente = 'prueba'`,
      [tenant],
    );
    expect(filas[0]?.version).toBe(2);
    expect(filas[0]?.config.tono).toBe('cercano');
  });

  it('revertir no deshace: crea la versión 3 con el contenido de la 1 y lo dice', async () => {
    const version = await guardar({ tono: 'neutro' }, 'L1', 'Revertida desde la versión 1', 1);
    expect(version).toBe(3);

    const historial = await db.comoUsuario<{
      version: number;
      tono: string;
      revertida_de: number | null;
    }>(
      ana,
      `select version, config->>'tono' as tono, revertida_de from public.agent_configs
       where tenant_id = $1 and agente = 'prueba' order by version`,
      [tenant],
    );

    expect(historial).toEqual([
      { version: 1, tono: 'neutro', revertida_de: null },
      { version: 2, tono: 'cercano', revertida_de: null },
      { version: 3, tono: 'neutro', revertida_de: 1 },
    ]);
  });

  it('una versión guardada no se puede modificar desde una sesión de usuario', async () => {
    // Aquí rebota antes el privilegio que el trigger: a `authenticated` solo se
    // le conceden `select` e `insert` sobre la tabla. Son dos capas y las dos
    // valen; lo que importa es que la fila no cambie.
    await expect(
      db.comoUsuario(
        ana,
        `update public.agent_configs set config = '{"tono":"otro"}'::jsonb
         where tenant_id = $1 and version = 1`,
        [tenant],
      ),
    ).rejects.toThrow(/permission denied|append-only/);

    const filas = await db.comoUsuario<{ tono: string }>(
      ana,
      `select config->>'tono' as tono from public.agent_configs
       where tenant_id = $1 and version = 1`,
      [tenant],
    );
    expect(filas[0]?.tono).toBe('neutro');
  });

  it('ni con el rol propietario de la base, que es el que sí tendría privilegio', async () => {
    await expect(
      db.crudo(
        `update public.agent_configs set config = '{"tono":"otro"}'::jsonb where tenant_id = $1`,
        [tenant],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('ni borrar, ni siquiera con el rol propietario de la base', async () => {
    await expect(
      db.crudo('delete from public.agent_configs where tenant_id = $1 and version = 2', [tenant]),
    ).rejects.toThrow(/append-only/);
  });
});

describe('T1.6 · la base rechaza una configuración imposible', () => {
  it('un nivel de autonomía inventado no entra', async () => {
    await expect(guardar({ tono: 'neutro' }, 'L9')).rejects.toThrow(/nivel_autonomia/);
  });

  it('una clave de agente con espacios o mayúsculas no entra', async () => {
    await expect(
      db.comoUsuario(
        ana,
        `insert into public.agent_configs (tenant_id, agente, config)
         values ($1, 'Agente De Prueba', '{}'::jsonb)`,
        [tenant],
      ),
    ).rejects.toThrow(/agente/);
  });
});

describe('F1.12 · el nivel de autonomía es una columna, no una preferencia de la UI', () => {
  it('se guarda por versión, así que el historial dice con qué nivel corría el agente', async () => {
    await guardar({ tono: 'neutro' }, 'L0', 'Bajado a L0 para probar');
    const filas = await db.comoUsuario<{ nivel_autonomia: string }>(
      ana,
      `select nivel_autonomia from public.agent_configs_vigentes
       where tenant_id = $1 and agente = 'prueba'`,
      [tenant],
    );
    expect(filas[0]?.nivel_autonomia).toBe('L0');
  });

  it('los cuatro niveles del plan son válidos y ninguno más', async () => {
    const filas = await db.crudo<{ definicion: string }>(
      `select pg_get_constraintdef(oid) as definicion from pg_constraint
       where conrelid = 'public.agent_configs'::regclass
         and pg_get_constraintdef(oid) like '%nivel_autonomia%'`,
    );
    const definicion = filas[0]?.definicion ?? '';
    for (const nivel of ['L0', 'L1', 'L2', 'L3']) {
      expect(definicion).toContain(nivel);
    }
  });
});

describe('los pasos del flujo se versionan igual', () => {
  it('numeración independiente por paso', async () => {
    const primera = await db.comoUsuario<{ version: number }>(
      ana,
      `insert into public.flow_configs (tenant_id, paso, config)
       values ($1, 'cualificacion', '{"umbral":60}'::jsonb) returning version`,
      [tenant],
    );
    const otra = await db.comoUsuario<{ version: number }>(
      ana,
      `insert into public.flow_configs (tenant_id, paso, config)
       values ($1, 'cadencia', '{"dias":3}'::jsonb) returning version`,
      [tenant],
    );
    expect([primera[0]?.version, otra[0]?.version]).toEqual([1, 1]);
  });
});
