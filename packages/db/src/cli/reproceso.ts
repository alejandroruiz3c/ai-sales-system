#!/usr/bin/env node
/**
 * `pnpm eventos:reproceso` · reinyecta en la cola eventos que ya existen.
 *
 * Es la herramienta que el ADR 0002 exige para poder aceptar Inngest en la ruta
 * crítica, y su especificación está escrita desde F0 en
 * `docs/runbooks/reproceso-de-eventos.md`. Las cinco reglas del runbook, con
 * dónde se cumple cada una:
 *
 *   1. **Nunca sin `--tenant`.** Sin tenant, aborta (abajo, `principal`).
 *   2. **En seco por defecto.** Publicar exige `--confirmar`.
 *   3. **Reutiliza el `event_id` original**, para que la guarda de idempotencia
 *      `(tenant_id, event_id)` de cada función sirva de algo.
 *   4. **Deja rastro**: cada reinyección se apunta en `event_reinyecciones`,
 *      que es append-only, con quién, cuándo y por qué.
 *   5. **El sandbox sigue activo.** Esta herramienta no lo toca y no puede:
 *      el interceptor se activa por `SALES_OS_ENV` y falla cerrado.
 *
 *   pnpm eventos:reproceso --tenant <uuid> --desde "2026-09-18T08:00:00Z"
 *   pnpm eventos:reproceso --tenant <uuid> --evento <uuid> --motivo "…" --confirmar
 *
 * Publica contra la API de eventos de Inngest con `fetch`, sin su SDK. No es
 * por ahorrar una dependencia: `packages/db` es la frontera con Postgres y no
 * debe conocer el orquestador. Si mañana el orquestador cambia, lo que cambia
 * es este fichero, y la tabla `events` —que es la fuente de verdad— no se
 * entera.
 */

import process from 'node:process';

import { nombreInngest } from '@sales-os/core';

import { crearEjecutorPostgres } from './ejecutor-postgres.ts';

interface Opciones {
  tenant?: string | undefined;
  evento?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
  motivo: string;
  confirmar: boolean;
  soloHuecos: boolean;
}

/** La salida de una herramienta de línea de órdenes es su interfaz, así que va
 * por `stdout` y no por el log estructurado, igual que en `scripts/src`. */
function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function leerOpciones(argv: readonly string[]): Opciones {
  const valor = (bandera: string): string | undefined => {
    const i = argv.indexOf(bandera);
    return i === -1 ? undefined : argv[i + 1];
  };

  const opciones: Opciones = {
    motivo: valor('--motivo') ?? 'Reproceso manual sin motivo anotado',
    confirmar: argv.includes('--confirmar'),
    // En seco por defecto, y solo los huecos por defecto: reinyectar todo un
    // rango cuando solo faltaban tres eventos es repetir trabajo ya hecho.
    soloHuecos: !argv.includes('--todos'),
  };

  for (const bandera of ['tenant', 'evento', 'desde', 'hasta'] as const) {
    const leido = valor(`--${bandera}`);
    if (leido !== undefined) opciones[bandera] = leido;
  }

  return opciones;
}

interface FilaDeEvento {
  id: string;
  nombre: string;
  version: number;
  agente: string;
  datos: Record<string, unknown>;
  creado_en: string;
}

/** Publica en Inngest reusando el id original como clave de idempotencia. */
async function publicar(evento: FilaDeEvento, tenantId: string, clave: string): Promise<void> {
  const respuesta = await fetch(`https://inn.gs/e/${clave}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: nombreInngest(evento.nombre, evento.version),
      // `id` es la clave de deduplicación de Inngest: el mismo evento
      // reinyectado dos veces no se procesa dos veces.
      id: evento.id,
      data: { ...evento.datos, tenantId, eventId: evento.id, reproceso: true },
    }),
  });

  if (!respuesta.ok) {
    throw new Error(`Inngest ha respondido ${String(respuesta.status)} al publicar ${evento.id}`);
  }
}

function escapar(valor: string): string {
  return valor.replace(/'/g, "''");
}

async function principal(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));

  if (opciones.tenant === undefined || !UUID.test(opciones.tenant)) {
    console.error(
      [
        'Falta --tenant, o no es un uuid.',
        '',
        'Un reproceso sin tenant es un reproceso en los datos de otro corporate',
        '(docs/runbooks/reproceso-de-eventos.md, paso 1). Por eso aborta.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const url = process.env['DATABASE_DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    console.error('Falta DATABASE_URL en el entorno.');
    process.exitCode = 1;
    return;
  }

  const claveInngest = process.env['INNGEST_EVENT_KEY'];
  if (opciones.confirmar && (claveInngest === undefined || claveInngest.trim() === '')) {
    console.error('Falta INNGEST_EVENT_KEY: sin ella no se puede publicar nada.');
    process.exitCode = 1;
    return;
  }

  const tenant = escapar(opciones.tenant);
  const ejecutor = crearEjecutorPostgres(url);

  try {
    let consulta: string;
    if (opciones.evento !== undefined) {
      if (!UUID.test(opciones.evento)) {
        console.error('--evento no es un uuid.');
        process.exitCode = 1;
        return;
      }
      consulta = `select e.id, e.nombre, e.version, e.agente, e.datos, e.creado_en::text as creado_en
                  from public.events e
                  where e.tenant_id = '${tenant}' and e.id = '${escapar(opciones.evento)}'`;
    } else if (opciones.soloHuecos) {
      const desde =
        opciones.desde === undefined
          ? "now() - interval '24 hours'"
          : `'${escapar(opciones.desde)}'::timestamptz`;
      const hasta =
        opciones.hasta === undefined ? 'now()' : `'${escapar(opciones.hasta)}'::timestamptz`;
      consulta = `select h.id, h.nombre, h.version, h.agente, e.datos, h.creado_en::text as creado_en
                  from app.eventos_sin_ejecucion('${tenant}'::uuid, ${desde}, ${hasta}) h
                  join public.events e on e.id = h.id
                  order by h.creado_en`;
    } else {
      const desde =
        opciones.desde === undefined
          ? "now() - interval '24 hours'"
          : `'${escapar(opciones.desde)}'::timestamptz`;
      const hasta =
        opciones.hasta === undefined ? 'now()' : `'${escapar(opciones.hasta)}'::timestamptz`;
      consulta = `select e.id, e.nombre, e.version, e.agente, e.datos, e.creado_en::text as creado_en
                  from public.events e
                  where e.tenant_id = '${tenant}'
                    and e.creado_en between ${desde} and ${hasta}
                  order by e.creado_en`;
    }

    const eventos = await ejecutor.consultar<FilaDeEvento>(consulta);

    escribir(`▸ Tenant ${opciones.tenant}`);
    escribir(
      `▸ ${String(eventos.length)} eventos ${opciones.soloHuecos && opciones.evento === undefined ? 'sin ejecución registrada' : 'en el rango'}`,
    );

    if (eventos.length === 0) {
      escribir(
        '\nNada que reprocesar. Si el problema persiste, no es de entrega: sigue por el paso 5 del runbook.',
      );
      return;
    }

    for (const evento of eventos) {
      escribir(
        `  · ${evento.creado_en}  ${evento.nombre} v${String(evento.version)}  ${evento.id}`,
      );
    }

    if (!opciones.confirmar) {
      escribir(
        [
          '',
          'En seco: no se ha publicado nada.',
          '',
          'Antes de añadir --confirmar, los dos pasos que el runbook no deja saltarse:',
          '  · paso 2: comprueba en el panel de Inngest que los eventos NO llegaron.',
          '    Si llegaron y la función falló, reinyectar solo repite el mismo error.',
          '  · paso 3: confirma que la función que los consume es idempotente por',
          '    (tenant_id, event_id). Si no lo es, el arreglo es añadir la guarda.',
          '',
          `Para publicar:  --confirmar --motivo "por qué"`,
        ].join('\n'),
      );
      return;
    }

    if (claveInngest === undefined) return;

    let publicados = 0;
    for (const evento of eventos) {
      await publicar(evento, opciones.tenant, claveInngest);
      await ejecutor.ejecutar(
        `insert into public.event_reinyecciones (tenant_id, event_id, motivo, quien)
         values ('${tenant}', '${evento.id}', '${escapar(opciones.motivo)}', '${escapar(process.env['USER'] ?? 'cli')}')`,
      );
      publicados += 1;
    }

    escribir(`\n✔ ${String(publicados)} eventos reinyectados y apuntados en event_reinyecciones.`);
    escribir('Anota en el issue el rango y el conteo (runbook, paso 6).');
  } finally {
    await ejecutor.cerrar();
  }
}

await principal();
