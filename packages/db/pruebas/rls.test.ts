/**
 * Aislamiento entre corporates (F1.2, caso T1.3).
 *
 * Esto es lo que decide si la fase se entrega. El plan lo dice sin matices:
 * «T1.3 es innegociable: si falla, se para todo». Y el ADR 0003 lo explica:
 * «que un tenant vea datos de otro no es un bug, es el final del producto».
 *
 * Los tests corren contra un Postgres de verdad (embebido) con las migraciones
 * aplicadas, porque lo que hay que demostrar es un comportamiento de la base.
 * Un test con dobles demostraría que el código llama a lo que creemos que
 * llama, que es justo lo que no falla.
 *
 * Dos de estos tests no comprueban datos sino **la forma del esquema**: que
 * toda tabla lleve `tenant_id` y RLS, y que `anon` no tenga privilegios. Son
 * los que siguen protegiendo el sistema en F7, cuando nadie recuerde esta
 * sesión y alguien añada una tabla con prisa.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TABLAS_SIN_TENANT_ID } from '../src/esquema/index.ts';
import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

let db: BaseDePruebas;

/** Aurora y Norte son corporates ficticios: no existe dato de negocio aquí. */
let aurora: string;
let norte: string;
let anaPropietariaDeAurora: string;
let luisLectorDeAurora: string;
let martaPropietariaDeNorte: string;
let tablasSembradas: readonly string[];

beforeAll(async () => {
  db = await levantarBaseDePruebas();

  anaPropietariaDeAurora = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  luisLectorDeAurora = await db.crearUsuario('luis@ejemplo.test', 'Luis');
  martaPropietariaDeNorte = await db.crearUsuario('marta@ejemplo.test', 'Marta');

  aurora = await db.crearTenant(anaPropietariaDeAurora, 'Corporate Uno Demo', 'uno-demo');
  norte = await db.crearTenant(martaPropietariaDeNorte, 'Corporate Dos Demo', 'dos-demo');

  await db.anadirMiembro(aurora, luisLectorDeAurora, 'lector');

  tablasSembradas = await db.sembrarTodasLasTablas(norte);
  await db.sembrarTodasLasTablas(aurora);
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('T1.3 · un tenant no ve los datos de otro', () => {
  it('no deja sin sembrar ninguna tabla de tenant, para que el test no pase por vacío', async () => {
    const enLaBase = await db.tablasDeTenant();
    const sinSembrar = enLaBase.filter((t) => !tablasSembradas.includes(t));

    expect(
      sinSembrar,
      [
        'Estas tablas llevan tenant_id y el test de fuga no siembra ninguna fila en ellas,',
        'así que "no se ven filas del otro tenant" sería cierto por vacío.',
        'Añádelas a sembrarTodasLasTablas() en pruebas/base-de-pruebas.ts.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('el propietario de un corporate lee cero filas de las tablas del otro', async () => {
    for (const tabla of tablasSembradas) {
      // `tenant_secrets` no concede nada a `authenticated`, así que no devuelve
      // cero filas: devuelve «permiso denegado». Se comprueba en
      // secretos.test.ts, que es donde se explica por qué está así.
      if (tabla === 'tenant_secrets') continue;

      const propias = await db.comoUsuario<{ n: string }>(
        anaPropietariaDeAurora,
        `select count(*)::text as n from public.${tabla} where tenant_id = $1`,
        [aurora],
      );
      const ajenas = await db.comoUsuario<{ n: string }>(
        anaPropietariaDeAurora,
        `select count(*)::text as n from public.${tabla} where tenant_id = $1`,
        [norte],
      );

      expect(Number(propias[0]?.n), `${tabla}: no ve ni sus propias filas`).toBeGreaterThan(0);
      expect(Number(ajenas[0]?.n), `FUGA en ${tabla}: ve filas del otro corporate`).toBe(0);
    }
  });

  it('un select sin filtro solo devuelve filas del propio corporate', async () => {
    const filas = await db.comoUsuario<{ tenant_id: string }>(
      anaPropietariaDeAurora,
      'select distinct tenant_id from public.events',
    );
    expect(filas.map((f) => f.tenant_id)).toEqual([aurora]);
  });

  it('el corporate ajeno no aparece ni en la tabla de tenants', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      'select id from public.tenants',
    );
    expect(filas.map((f) => f.id)).toEqual([aurora]);
  });

  it('no se puede escribir una fila en el corporate de otro', async () => {
    await expect(
      db.comoUsuario(
        anaPropietariaDeAurora,
        `insert into public.events (tenant_id, nombre) values ($1, 'prospect.ingested')`,
        [norte],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('un update contra el corporate de otro no toca ninguna fila', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      `update public.machines set salud = 'mala' where tenant_id = $1 returning id`,
      [norte],
    );
    expect(filas).toEqual([]);

    // Y de verdad no cambió: se comprueba con el rol propietario, que ve todo.
    const salud = await db.crudo<{ salud: string }>(
      'select salud from public.machines where tenant_id = $1',
      [norte],
    );
    expect(salud[0]?.salud).toBe('buena');
  });

  it('un delete contra el corporate de otro no borra nada', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      `delete from public.machines where tenant_id = $1 returning id`,
      [norte],
    );
    expect(filas).toEqual([]);
  });

  it('cambiar el nombre del corporate ajeno no hace nada', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      `update public.tenants set nombre = 'Secuestrado' where id = $1 returning id`,
      [norte],
    );
    expect(filas).toEqual([]);
  });

  it('el resumen del panel se niega a hablar de un corporate ajeno', async () => {
    await expect(
      db.comoUsuario(anaPropietariaDeAurora, 'select app.resumen_del_tenant($1)', [norte]),
    ).rejects.toThrow(/Sin acceso a este corporate/);
  });
});

describe('T1.2 · un lector ve y no cambia nada', () => {
  it('lee los datos de su corporate', async () => {
    const filas = await db.comoUsuario<{ n: string }>(
      luisLectorDeAurora,
      'select count(*)::text as n from public.events where tenant_id = $1',
      [aurora],
    );
    expect(Number(filas[0]?.n)).toBeGreaterThan(0);
  });

  it('no puede guardar una versión de configuración', async () => {
    await expect(
      db.comoUsuario(
        luisLectorDeAurora,
        `insert into public.agent_configs (tenant_id, agente, config)
         values ($1, 'prueba', '{"tono":"cercano"}'::jsonb)`,
        [aurora],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('no puede subir un archivo', async () => {
    await expect(
      db.comoUsuario(
        luisLectorDeAurora,
        `insert into public.tenant_files (tenant_id, carpeta, nombre)
         values ($1, 'inputs', 'del-lector.pdf')`,
        [aurora],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('no puede invitar a nadie', async () => {
    await expect(
      db.comoUsuario(
        luisLectorDeAurora,
        `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en)
         values ($1, 'otro@ejemplo.test', 'editor', 'hash-del-lector', now() + interval '1 day')`,
        [aurora],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('no puede subirse el presupuesto', async () => {
    const filas = await db.comoUsuario<{ tenant_id: string }>(
      luisLectorDeAurora,
      `update public.tenant_budgets set limite_eur = 1000 where tenant_id = $1 returning tenant_id`,
      [aurora],
    );
    expect(filas).toEqual([]);
  });

  it('no puede ascenderse a administrador', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      luisLectorDeAurora,
      `update public.memberships set rol = 'propietario'
       where tenant_id = $1 and usuario_id = $2 returning id`,
      [aurora, luisLectorDeAurora],
    );
    expect(filas).toEqual([]);
  });

  it('no puede marcarse como administrador de plataforma', async () => {
    // La política le dejaría actualizar su propia fila, pero la columna no está
    // en el `grant`, así que el intento ni llega a evaluarse.
    await expect(
      db.comoUsuario(
        luisLectorDeAurora,
        'update public.perfiles set es_admin_plataforma = true where id = $1',
        [luisLectorDeAurora],
      ),
    ).rejects.toThrow(/permission denied|permiso/i);
  });

  it('sí puede cambiarse el nombre, que es lo único suyo', async () => {
    await db.comoUsuario(
      luisLectorDeAurora,
      'update public.perfiles set nombre = $2 where id = $1',
      [luisLectorDeAurora, 'Luis Lector'],
    );
    const filas = await db.crudo<{ nombre: string }>(
      'select nombre from public.perfiles where id = $1',
      [luisLectorDeAurora],
    );
    expect(filas[0]?.nombre).toBe('Luis Lector');
  });
});

describe('sin sesión no se ve nada', () => {
  it('el rol anónimo no lee ni una fila de ninguna tabla', async () => {
    for (const tabla of tablasSembradas) {
      const resultado = await db
        .comoAnonimo<{ n: string }>(`select count(*)::text as n from public.${tabla}`)
        .then((filas) => Number(filas[0]?.n))
        .catch(() => 0); // Sin privilegio también es cero: las dos respuestas valen.

      expect(resultado, `${tabla}: el rol anónimo ve filas`).toBe(0);
    }
  });

  it('crear un corporate sin sesión falla', async () => {
    await expect(
      db.comoAnonimo(`select app.crear_tenant('Sin Sesion Demo', 'sin-sesion-demo')`),
    ).rejects.toThrow();
  });
});

describe('la forma del esquema, que es lo que aguanta cuando nadie recuerda esto', () => {
  it('toda tabla de public lleva tenant_id, salvo las excepciones escritas', async () => {
    const filas = await db.crudo<{ tabla: string; tiene_tenant: boolean }>(
      `select c.relname as tabla,
              exists (
                select 1 from information_schema.columns col
                where col.table_schema = 'public'
                  and col.table_name = c.relname
                  and col.column_name = 'tenant_id'
              ) as tiene_tenant
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );

    const sinTenant = filas
      .filter((f) => !f.tiene_tenant)
      .map((f) => f.tabla)
      .filter((tabla) => !(tabla in TABLAS_SIN_TENANT_ID));

    expect(
      sinTenant,
      [
        'Estas tablas no llevan tenant_id y no están en la lista de excepciones.',
        'Una tabla sin tenant_id es un agujero de aislamiento (CLAUDE.md §1).',
        'Si la excepción es legítima, añádela a TABLAS_SIN_TENANT_ID con su motivo y escribe su ADR.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('toda tabla de public tiene RLS activado', async () => {
    const filas = await db.crudo<{ tabla: string }>(
      `select c.relname as tabla
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
       order by c.relname`,
    );

    expect(
      filas.map((f) => f.tabla),
      'Estas tablas no tienen row level security activado: con el rol de un usuario devolverían todo.',
    ).toEqual([]);
  });

  it('el rol anónimo no tiene privilegios sobre ninguna tabla', async () => {
    const filas = await db.crudo<{ tabla: string; privilegio: string }>(
      `select table_name as tabla, privilege_type as privilegio
       from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
       order by table_name, privilege_type`,
    );

    expect(
      filas.map((f) => `${f.tabla}.${f.privilegio}`),
      'El rol anónimo tiene privilegios. Sin sesión no se lee una sola fila.',
    ).toEqual([]);
  });

  it('las vistas no se saltan RLS: todas son security_invoker', async () => {
    const filas = await db.crudo<{ vista: string }>(
      `select c.relname as vista
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
         and coalesce((
           select option_value from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'
         ), 'false') <> 'true'
       order by c.relname`,
    );

    expect(
      filas.map((f) => f.vista),
      'Una vista sin security_invoker se ejecuta con los permisos de quien la creó: es un agujero con forma de comodidad.',
    ).toEqual([]);
  });

  it('las vistas de configuración vigente también filtran por tenant', async () => {
    const filas = await db.comoUsuario<{ tenant_id: string }>(
      anaPropietariaDeAurora,
      'select distinct tenant_id from public.agent_configs_vigentes',
    );
    expect(filas.map((f) => f.tenant_id)).toEqual([aurora]);
  });
});

describe('la tabla de eventos es append-only (ADR 0002)', () => {
  it('no se puede modificar un evento ni con el rol propietario', async () => {
    await expect(
      db.crudo(`update public.events set nombre = 'otro.nombre' where tenant_id = $1`, [aurora]),
    ).rejects.toThrow(/append-only/);
  });

  it('no se puede borrar un evento ni con el rol propietario', async () => {
    await expect(
      db.crudo('delete from public.events where tenant_id = $1', [aurora]),
    ).rejects.toThrow(/append-only/);
  });

  it('tampoco se puede borrar un apunte del libro de gasto', async () => {
    await expect(
      db.crudo('delete from public.spend_ledger where tenant_id = $1', [aurora]),
    ).rejects.toThrow(/append-only/);
  });

  it('la clave de idempotencia evita que un reproceso duplique un evento', async () => {
    const primera = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      `select app.registrar_evento($1, 'outreach.step.sent', '{}'::jsonb, 'emailing', 'inngest', 1, null, 'clave-unica') as id`,
      [aurora],
    );
    const segunda = await db.comoUsuario<{ id: string }>(
      anaPropietariaDeAurora,
      `select app.registrar_evento($1, 'outreach.step.sent', '{}'::jsonb, 'emailing', 'inngest', 1, null, 'clave-unica') as id`,
      [aurora],
    );

    expect(segunda[0]?.id).toBe(primera[0]?.id);
  });
});
