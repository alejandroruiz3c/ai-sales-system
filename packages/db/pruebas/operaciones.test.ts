/**
 * Invitaciones, aprobaciones y reset del corporate de prueba
 * (F1.3, F1.10, F1.11, casos T1.1, T1.2, T1.7).
 */

import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { levantarBaseDePruebas, type BaseDePruebas } from './base-de-pruebas.ts';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

let db: BaseDePruebas;
let ana: string;
let tenant: string;

beforeAll(async () => {
  db = await levantarBaseDePruebas();
  ana = await db.crearUsuario('ana@ejemplo.test', 'Ana');
  tenant = await db.crearTenant(ana, 'Corporate Uno Demo', 'uno-demo');
}, 120_000);

afterAll(async () => {
  await db.cerrar();
});

describe('T1.1 · crear un corporate', () => {
  it('deja a quien lo crea como propietario, con presupuesto y con evento', async () => {
    const rol = await db.comoUsuario<{ rol: string }>(
      ana,
      'select rol from public.memberships where tenant_id = $1 and usuario_id = $2',
      [tenant, ana],
    );
    expect(rol[0]?.rol).toBe('propietario');

    const presupuesto = await db.comoUsuario<{ n: string }>(
      ana,
      'select count(*)::text as n from public.tenant_budgets where tenant_id = $1',
      [tenant],
    );
    expect(Number(presupuesto[0]?.n)).toBe(1);

    const evento = await db.comoUsuario<{ nombre: string }>(
      ana,
      `select nombre from public.events where tenant_id = $1 and nombre = 'tenant.created'`,
      [tenant],
    );
    expect(evento).toHaveLength(1);
  });

  it('dos corporates del mismo usuario aparecen los dos en su selector', async () => {
    await db.crearTenant(ana, 'Corporate Dos Demo', 'dos-demo');
    const filas = await db.comoUsuario<{ nombre: string }>(
      ana,
      'select nombre from public.tenants order by nombre',
    );
    expect(filas.map((f) => f.nombre)).toEqual(['Corporate Dos Demo', 'Corporate Uno Demo']);
  });

  it('un slug repetido se rechaza', async () => {
    await expect(
      db.comoUsuario(ana, `select app.crear_tenant('Otro Demo', 'uno-demo')`),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('un slug con mayúsculas o espacios se rechaza', async () => {
    await expect(
      db.comoUsuario(ana, `select app.crear_tenant('Otro Demo', 'Uno Demo')`),
    ).rejects.toThrow(/slug/);
  });

  it('un presupuesto negativo se rechaza', async () => {
    await expect(
      db.comoUsuario(
        ana,
        `select app.crear_tenant('Otro Demo', 'otro-demo', 'Europe/Madrid', 'es', true, -1)`,
      ),
    ).rejects.toThrow(/negativo/);
  });
});

describe('T1.2 · invitar a un lector', () => {
  it('el token no se guarda: solo su sha256', async () => {
    const token = 'token-de-prueba-suficientemente-largo';
    await db.comoUsuario(
      ana,
      `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en, creada_por)
       values ($1, 'luis@ejemplo.test', 'lector', $2, now() + interval '7 days', $3)`,
      [tenant, hash(token), ana],
    );

    const filas = await db.crudo<{ token_hash: string }>(
      'select token_hash from public.invitaciones where tenant_id = $1',
      [tenant],
    );
    expect(filas[0]?.token_hash).toBe(hash(token));
    expect(filas[0]?.token_hash).not.toBe(token);
  });

  it('el invitado la acepta y entra como lector', async () => {
    const token = 'token-de-prueba-suficientemente-largo';
    const luis = await db.crearUsuario('luis@ejemplo.test', 'Luis');

    const resultado = await db.comoUsuario<{ id: string }>(
      luis,
      'select app.aceptar_invitacion($1) as id',
      [hash(token)],
    );
    expect(resultado[0]?.id).toBe(tenant);

    const rol = await db.comoUsuario<{ rol: string }>(
      luis,
      'select rol from public.memberships where tenant_id = $1 and usuario_id = $2',
      [tenant, luis],
    );
    expect(rol[0]?.rol).toBe('lector');
  });

  it('no se puede aceptar dos veces', async () => {
    const token = 'token-de-prueba-suficientemente-largo';
    const luis = await db.crearUsuario('luis2@ejemplo.test', 'Luis Dos');
    await expect(
      db.comoUsuario(luis, 'select app.aceptar_invitacion($1)', [hash(token)]),
    ).rejects.toThrow(/ya está aceptada/);
  });

  it('un enlace reenviado por error no sirve a quien lo recibe', async () => {
    const token = 'token-para-otra-persona-largo';
    await db.comoUsuario(
      ana,
      `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en, creada_por)
       values ($1, 'destinataria@ejemplo.test', 'editor', $2, now() + interval '7 days', $3)`,
      [tenant, hash(token), ana],
    );

    const intrusa = await db.crearUsuario('intrusa@ejemplo.test', 'Intrusa');
    await expect(
      db.comoUsuario(intrusa, 'select app.aceptar_invitacion($1)', [hash(token)]),
    ).rejects.toThrow(/para otra dirección de correo/);
  });

  it('una invitación vencida no sirve, aunque siga en estado pendiente', async () => {
    const token = 'token-caducado-suficientemente-largo';
    await db.crudo(
      `insert into public.invitaciones (tenant_id, email, rol, token_hash, expira_en, creada_por)
       values ($1, 'tarde@ejemplo.test', 'lector', $2, now() - interval '1 day', $3)`,
      [tenant, hash(token), ana],
    );
    const tarde = await db.crearUsuario('tarde@ejemplo.test', 'Tarde');

    await expect(
      db.comoUsuario(tarde, 'select app.aceptar_invitacion($1)', [hash(token)]),
    ).rejects.toThrow(/ha caducado/);

    // Lo que decide es `expira_en`, no el estado. Marcarlo dentro de la misma
    // función no serviría: la excepción deshace la transacción y el apunte se
    // perdería, así que quien lo marca es el barrido de abajo.
    const filas = await db.crudo<{ estado: string }>(
      'select estado from public.invitaciones where token_hash = $1',
      [hash(token)],
    );
    expect(filas[0]?.estado).toBe('pendiente');
  });

  it('el barrido de caducadas sí las marca, y no toca las vigentes', async () => {
    const cuantas = await db.comoUsuario<{ n: number }>(
      ana,
      'select app.caducar_invitaciones($1) as n',
      [tenant],
    );
    expect(cuantas[0]?.n).toBe(1);

    const estados = await db.crudo<{ estado: string; vencida: boolean }>(
      `select estado, expira_en < now() as vencida from public.invitaciones
       where tenant_id = $1 order by creada_en`,
      [tenant],
    );
    for (const fila of estados) {
      if (fila.vencida && fila.estado !== 'aceptada') {
        expect(fila.estado).toBe('caducada');
      }
    }
  });

  it('un token que no existe no dice si existe o no otro', async () => {
    const nadie = await db.crearUsuario('nadie@ejemplo.test', 'Nadie');
    await expect(
      db.comoUsuario(nadie, 'select app.aceptar_invitacion($1)', [hash('inventado')]),
    ).rejects.toThrow(/no encontrada/);
  });
});

describe('T1.7 · aprobar, editando, emite el evento', () => {
  it('aprobar con edición emite el evento anotado y marca la edición', async () => {
    const creada = await db.comoUsuario<{ id: string }>(
      ana,
      `insert into public.approvals
         (tenant_id, agente, tipo, titulo, contenido_propuesto, evento_al_aprobar, creada_por)
       values ($1, 'prueba', 'mensaje', 'Mensaje de prueba',
               '{"texto":"Texto propuesto por el agente"}'::jsonb,
               'outreach.step.sent', $2)
       returning id`,
      [tenant, ana],
    );
    const id = creada[0]?.id;

    const resuelta = await db.comoUsuario<{
      r: { estado: string; editada: boolean; evento_emitido_id: string | null };
    }>(
      ana,
      `select app.resolver_aprobacion($1, 'aprobada', '{"texto":"Texto editado por Alex"}'::jsonb) as r`,
      [id],
    );

    expect(resuelta[0]?.r.estado).toBe('aprobada');
    expect(resuelta[0]?.r.editada).toBe(true);
    expect(resuelta[0]?.r.evento_emitido_id).not.toBeNull();

    const eventos = await db.comoUsuario<{ nombre: string; texto: string; editada: boolean }>(
      ana,
      `select nombre, datos->'contenido'->>'texto' as texto, (datos->>'editada')::boolean as editada
       from public.events
       where tenant_id = $1 and nombre = 'outreach.step.sent'`,
      [tenant],
    );
    expect(eventos[0]?.texto).toBe('Texto editado por Alex');
    expect(eventos[0]?.editada).toBe(true);

    // Y la propuesta original sigue ahí, para poder comparar.
    const fila = await db.comoUsuario<{ propuesto: string; final: string }>(
      ana,
      `select contenido_propuesto->>'texto' as propuesto, contenido_final->>'texto' as final
       from public.approvals where id = $1`,
      [id],
    );
    expect(fila[0]?.propuesto).toBe('Texto propuesto por el agente');
    expect(fila[0]?.final).toBe('Texto editado por Alex');
  });

  it('rechazar no emite el evento de la acción', async () => {
    const creada = await db.comoUsuario<{ id: string }>(
      ana,
      `insert into public.approvals
         (tenant_id, agente, tipo, titulo, contenido_propuesto, evento_al_aprobar, creada_por)
       values ($1, 'prueba', 'mensaje', 'Para rechazar', '{"texto":"No"}'::jsonb,
               'outreach.step.sent', $2)
       returning id`,
      [tenant, ana],
    );

    await db.comoUsuario(
      ana,
      `select app.resolver_aprobacion($1, 'rechazada', null, 'No encaja')`,
      [creada[0]?.id],
    );

    const eventos = await db.comoUsuario<{ n: string }>(
      ana,
      `select count(*)::text as n from public.events
       where tenant_id = $1 and nombre = 'outreach.step.sent'`,
      [tenant],
    );
    // Solo el de la aprobación anterior, no uno nuevo.
    expect(Number(eventos[0]?.n)).toBe(1);

    const rechazo = await db.comoUsuario<{ n: string }>(
      ana,
      `select count(*)::text as n from public.events
       where tenant_id = $1 and nombre = 'approval.rejected'`,
      [tenant],
    );
    expect(Number(rechazo[0]?.n)).toBe(1);
  });

  it('una aprobación resuelta no se resuelve otra vez', async () => {
    const filas = await db.comoUsuario<{ id: string }>(
      ana,
      `select id from public.approvals where tenant_id = $1 and estado = 'aprobada' limit 1`,
      [tenant],
    );
    await expect(
      db.comoUsuario(ana, `select app.resolver_aprobacion($1, 'rechazada')`, [filas[0]?.id]),
    ).rejects.toThrow(/ya está aprobada/);
  });

  it('un lector no resuelve aprobaciones', async () => {
    const creada = await db.comoUsuario<{ id: string }>(
      ana,
      `insert into public.approvals
         (tenant_id, agente, tipo, titulo, contenido_propuesto, creada_por)
       values ($1, 'prueba', 'mensaje', 'Pendiente', '{"texto":"x"}'::jsonb, $2)
       returning id`,
      [tenant, ana],
    );
    const luis = await db.crearUsuario('lector@ejemplo.test', 'Lector');
    await db.anadirMiembro(tenant, luis, 'lector');

    await expect(
      db.comoUsuario(luis, `select app.resolver_aprobacion($1, 'aprobada')`, [creada[0]?.id]),
    ).rejects.toThrow(/row-level security|no encontrada/i);

    const estado = await db.crudo<{ estado: string }>(
      'select estado from public.approvals where id = $1',
      [creada[0]?.id],
    );
    expect(estado[0]?.estado).toBe('pendiente');
  });
});

describe('reset del corporate de prueba', () => {
  it('borra un corporate demo entero, eventos incluidos', async () => {
    const marta = await db.crearUsuario('marta@ejemplo.test', 'Marta');
    const demo = await db.crearTenant(marta, 'Corporate Demo Borrable', 'demo-borrable');
    await db.sembrarTodasLasTablas(demo);

    const borrado = await db.comoUsuario<{ ok: boolean }>(
      marta,
      'select app.purgar_tenant_demo($1) as ok',
      [demo],
    );
    expect(borrado[0]?.ok).toBe(true);

    for (const tabla of ['events', 'spend_ledger', 'tenant_files', 'memberships']) {
      const filas = await db.crudo<{ n: string }>(
        `select count(*)::text as n from public.${tabla} where tenant_id = $1`,
        [demo],
      );
      expect(Number(filas[0]?.n), `${tabla} conserva filas del corporate borrado`).toBe(0);
    }
  });

  it('se niega a borrar un corporate que no está marcado como demo', async () => {
    const marta = await db.crearUsuario('marta2@ejemplo.test', 'Marta Dos');
    const real = await db.crearTenant(marta, 'Corporate No Demo', 'no-demo');
    await db.crudo('update public.tenants set es_demo = false where id = $1', [real]);

    await expect(
      db.comoUsuario(marta, 'select app.purgar_tenant_demo($1)', [real]),
    ).rejects.toThrow(/corporates de prueba/);
  });

  it('un lector del corporate no lo puede borrar', async () => {
    const marta = await db.crearUsuario('marta3@ejemplo.test', 'Marta Tres');
    const demo = await db.crearTenant(marta, 'Corporate Demo Dos', 'demo-dos');
    const luis = await db.crearUsuario('lector2@ejemplo.test', 'Lector Dos');
    await db.anadirMiembro(demo, luis, 'lector');

    await expect(db.comoUsuario(luis, 'select app.purgar_tenant_demo($1)', [demo])).rejects.toThrow(
      /propietario o administrador de plataforma/,
    );
  });

  it('la marca de purga por sí sola no deja borrar un evento', async () => {
    // Cualquiera puede poner la marca de sesión. Lo que no puede es tener
    // permiso de `delete` sobre `events`, que es lo que de verdad protege.
    await expect(
      db.comoUsuario(
        ana,
        `select set_config('app.purga_de_tenant', 'on', true);
         delete from public.events where tenant_id = $1`,
        [tenant],
      ),
    ).rejects.toThrow();
  });
});

describe('huecos de entrega (ADR 0002, runbook de reproceso)', () => {
  it('lista los eventos sin ejecución registrada, y solo los del tenant', async () => {
    const filas = await db.comoUsuario<{ nombre: string }>(
      ana,
      `select nombre from app.eventos_sin_ejecucion($1, now() - interval '1 hour', now())`,
      [tenant],
    );
    expect(filas.length).toBeGreaterThan(0);

    // Al registrar una ejecución, el evento deja de aparecer como hueco.
    const uno = await db.crudo<{ id: string }>(
      'select id from public.events where tenant_id = $1 limit 1',
      [tenant],
    );
    await db.crudo(
      `insert into public.event_runs (tenant_id, event_id, funcion, estado)
       values ($1, $2, 'prueba', 'completada')`,
      [tenant, uno[0]?.id],
    );

    const despues = await db.comoUsuario<{ id: string }>(
      ana,
      `select id from app.eventos_sin_ejecucion($1, now() - interval '1 hour', now())`,
      [tenant],
    );
    expect(despues.map((f) => f.id)).not.toContain(uno[0]?.id);
  });
});
