import { NextResponse } from 'next/server';

import { NIVELES } from '@sales-os/agent-prueba';

import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

/**
 * Caso T1.9 · cambia el nivel de autonomía del agente de prueba.
 *
 * Existe aparte del panel porque `/lab` no tiene sesión de tenant, y porque el
 * caso del kit se lee mejor sin salir de la sala: bajas el nivel, vuelves a
 * pulsar y compruebas que la acción se genera y no se envía.
 *
 * Guarda una **versión nueva** de la configuración, igual que el panel: el
 * historial no tiene una puerta de atrás para la sala de pruebas.
 */
export async function POST(peticion: Request) {
  if ((await checkLabAccess()) !== 'autorizado') {
    return NextResponse.json({ error: 'Solo administradores de plataforma.' }, { status: 403 });
  }

  const cuerpo: unknown = await peticion.json().catch(() => ({}));
  const leer = (campo: string): string =>
    typeof cuerpo === 'object' && cuerpo !== null && campo in cuerpo
      ? String((cuerpo as Record<string, unknown>)[campo])
      : '';

  const tenantId = leer('tenantId');
  const nivel = leer('nivel');

  if (tenantId === '') {
    return NextResponse.json({ error: 'Falta el corporate de prueba.' }, { status: 400 });
  }
  if (!(NIVELES as readonly string[]).includes(nivel)) {
    return NextResponse.json({ error: 'El nivel es L0, L1, L2 o L3.' }, { status: 400 });
  }

  try {
    const resultado = await baseDeDatos().comoSistema(
      'Cambiar el nivel de autonomía del agente de prueba desde la sala de pruebas (T1.9)',
      async (ctx) => {
        const demo = await ctx.unaFila<{ es_demo: boolean }>(
          'select es_demo from public.tenants where id = $1',
          [tenantId],
        );
        if (demo?.es_demo !== true) {
          throw new Error('La sala de pruebas solo actúa sobre corporates de prueba.');
        }

        const vigente = await ctx.unaFila<{ config: unknown }>(
          `select config from public.agent_configs
           where tenant_id = $1 and agente = 'prueba' order by version desc limit 1`,
          [tenantId],
        );

        const base =
          typeof vigente?.config === 'object' && vigente.config !== null
            ? (vigente.config as Record<string, unknown>)
            : {
                objetivo:
                  'Generar una acción de prueba inofensiva para comprobar aprobaciones, presupuesto y nivel de autonomía',
                tono: 'neutro',
                idioma: 'es',
                ventanaHoraria: { desde: '09:00', hasta: '19:00', dias: [1, 2, 3, 4, 5] },
                limites: { porDia: 10, porSemana: 0 },
                recursosAdjuntos: [],
                especifico: { tono: 'neutro', limiteDiario: 10 },
              };

        const nueva = await ctx.unaFila<{ version: number }>(
          `insert into public.agent_configs
             (tenant_id, agente, config, nivel_autonomia, nota)
           values ($1, 'prueba', $2::text::jsonb, $3, $4)
           returning version`,
          [
            tenantId,
            JSON.stringify({ ...base, nivelAutonomia: nivel }),
            nivel,
            `Nivel cambiado a ${nivel} desde la sala de pruebas`,
          ],
        );

        await ctx.consultar(
          `select app.registrar_evento($1::uuid, 'config.published',
             jsonb_build_object('agente','prueba','version',$2::int,'nivel',$3::text),
             'prueba', 'lab')`,
          [tenantId, nueva?.version ?? 0, nivel],
        );

        return { nivel, version: nueva?.version ?? 0 };
      },
    );

    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 400 },
    );
  }
}
