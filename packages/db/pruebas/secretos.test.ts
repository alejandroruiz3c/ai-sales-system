/**
 * Secretos por tenant: cifrados, y fuera del alcance del panel (F1.7).
 *
 * El requisito del plan es «secreto nunca devuelto al frontend». Lo que se
 * prueba aquí es más fuerte que eso: que **el rol con el que habla el panel no
 * tiene forma de leerlo**. No hace falta confiar en que ninguna ruta de la API
 * lo devuelva por descuido, porque su conexión no puede obtenerlo.
 *
 * Vault no existe en el Postgres embebido, así que el ida y vuelta del valor
 * cifrado no se prueba aquí: se prueba contra staging y queda anotado en el
 * informe de entrega. Lo que sí se prueba aquí es lo que no depende de Vault y
 * es lo que puede romperse en un PR distraído: los permisos.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

let db: BaseDePruebas;
let ana: string;
let luis: string;
let editora: string;
let tenant: string;

beforeAll(async () => {
  db = await levantarBaseDePruebas();
  ana = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  luis = await db.crearUsuario('luis@ejemplo.test', 'Luis');
  editora = await db.crearUsuario('eva@ejemplo.test', 'Eva');
  tenant = await db.crearTenant(ana, 'Corporate Uno Demo', 'uno-demo');
  await db.anadirMiembro(tenant, luis, 'lector');
  await db.anadirMiembro(tenant, editora, 'editor');

  await db.crudo(
    `insert into public.tenant_secrets (tenant_id, nombre, vault_secret_id, descripcion)
     values ($1, 'CRM_API_KEY', gen_random_uuid(), 'Clave del CRM de prueba')`,
    [tenant],
  );
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('la tabla de secretos no responde a una sesión de usuario', () => {
  it('ni al propietario del corporate', async () => {
    await expect(db.comoUsuario(ana, 'select * from public.tenant_secrets')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('y por tanto tampoco puede filtrar el identificador de Vault', async () => {
    await expect(
      db.comoUsuario(ana, 'select vault_secret_id from public.tenant_secrets'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('sigue sin tener ninguna política, que es el mecanismo y no un olvido', async () => {
    const filas = await db.crudo<{ policyname: string }>(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'tenant_secrets'`,
    );
    expect(
      filas.map((f) => f.policyname),
      [
        'Alguien ha añadido una política a tenant_secrets.',
        'Esa tabla no tiene políticas a propósito: es lo que impide que la sesión de un',
        'usuario llegue al identificador del secreto en Vault (F1.7).',
      ].join('\n'),
    ).toEqual([]);
  });

  it('y sin ningún privilegio para `authenticated`', async () => {
    const filas = await db.crudo<{ privilegio: string }>(
      `select privilege_type as privilegio from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'tenant_secrets' and grantee = 'authenticated'`,
    );
    expect(filas.map((f) => f.privilegio)).toEqual([]);
  });
});

describe('leer el valor solo lo puede hacer el sistema', () => {
  it('`authenticated` no puede ejecutar app.leer_secreto', async () => {
    await expect(
      db.comoUsuario(ana, `select app.leer_secreto($1, 'CRM_API_KEY')`, [tenant]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('ni guardarlo', async () => {
    await expect(
      db.comoUsuario(ana, `select app.guardar_secreto($1, 'OTRA_CLAVE', 'valor')`, [tenant]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('ni borrarlo', async () => {
    await expect(
      db.comoUsuario(ana, `select app.borrar_secreto($1, 'CRM_API_KEY')`, [tenant]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('y sin Vault el sistema se niega a guardar en claro', async () => {
    // El Postgres embebido no trae Vault. La respuesta correcta es fallar, no
    // guardar el valor sin cifrar «solo en desarrollo».
    await expect(
      db.crudo(`select app.guardar_secreto($1, 'OTRA_CLAVE', 'valor')`, [tenant]),
    ).rejects.toThrow(/Vault no está disponible/);
  });
});

describe('el inventario sí se puede ver, y sin valores', () => {
  it('un administrador ve nombre y descripción, y nada más', async () => {
    const filas = await db.comoUsuario(ana, 'select * from app.listar_secretos($1)', [tenant]);
    expect(filas).toHaveLength(1);
    expect(Object.keys(filas[0] ?? {}).sort()).toEqual([
      'actualizado_en',
      'creado_en',
      'descripcion',
      'nombre',
      'ultimo_uso_en',
    ]);
    expect(filas[0]?.['nombre']).toBe('CRM_API_KEY');
  });

  it('un editor no ve el inventario: las credenciales son de administración', async () => {
    await expect(
      db.comoUsuario(editora, 'select * from app.listar_secretos($1)', [tenant]),
    ).rejects.toThrow(/administrador del corporate/);
  });

  it('un lector tampoco', async () => {
    await expect(
      db.comoUsuario(luis, 'select * from app.listar_secretos($1)', [tenant]),
    ).rejects.toThrow(/administrador del corporate/);
  });

  it('y nadie ve el inventario de otro corporate', async () => {
    const marta = await db.crearUsuario('marta@ejemplo.test', 'Marta');
    const otro = await db.crearTenant(marta, 'Corporate Dos Demo', 'dos-demo');
    await expect(
      db.comoUsuario(ana, 'select * from app.listar_secretos($1)', [otro]),
    ).rejects.toThrow(/administrador del corporate/);
  });
});
