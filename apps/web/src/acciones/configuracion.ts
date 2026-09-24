'use server';

/**
 * Guardar y revertir la configuración de un agente (F1.8, F1.9, F1.12).
 *
 * Revertir **no deshace**: crea una versión nueva con el contenido de una
 * anterior y apunta de dónde viene. Es lo que pide el caso T1.5 —«el historial
 * muestra ambas versiones y la reversión funciona»— y también lo que hace que
 * dentro de tres semanas se pueda responder con qué instrucciones exactas se
 * escribió un mensaje.
 *
 * La validación es de servidor y con los mensajes de `@sales-os/db`, que están
 * escritos para leerse en un panel. Es lo que comprueba el caso T1.6.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { validarConfigDeAgente, type ErrorDeConfig } from '@sales-os/db';

import { agentePorClave } from '../lib/agentes.ts';
import { baseDeDatos } from '../lib/base-de-datos.ts';
import { numero, texto } from '../lib/formularios.ts';
import { sesionActual } from '../lib/sesion.ts';

export interface ResultadoDeConfig {
  readonly error?: string;
  readonly ok?: string;
  readonly errores?: readonly ErrorDeConfig[];
}

const NIVELES = ['L0', 'L1', 'L2', 'L3'] as const;

/** Guarda una versión nueva desde el formulario en lenguaje llano. */
export async function guardarConfig(
  _previo: ResultadoDeConfig,
  datos: FormData,
): Promise<ResultadoDeConfig> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const clave = texto(datos, 'agente');
  const agente = agentePorClave(clave);
  if (agente === undefined) return { error: 'Ese agente no está en el registro.' };

  const nivel = texto(datos, 'nivelAutonomia', 'L1');
  if (!(NIVELES as readonly string[]).includes(nivel)) {
    return { error: 'El nivel de autonomía es L0, L1, L2 o L3.' };
  }

  const dias = datos
    .getAll('dias')
    .filter((d): d is string => typeof d === 'string')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);

  const config = {
    objetivo: texto(datos, 'objetivo').trim(),
    tono: texto(datos, 'tono', 'neutro'),
    idioma: texto(datos, 'idioma', 'es'),
    nivelAutonomia: nivel,
    ventanaHoraria: {
      desde: texto(datos, 'desde', '09:00'),
      hasta: texto(datos, 'hasta', '19:00'),
      dias,
    },
    limites: {
      porDia: numero(datos, 'porDia') ?? 0,
      porSemana: numero(datos, 'porSemana') ?? 0,
    },
    recursosAdjuntos: [] as string[],
    especifico: {},
  };

  const validacion = validarConfigDeAgente(config);
  if (!validacion.valida || validacion.datos === undefined) {
    return {
      error: 'Hay campos que no se pueden guardar así.',
      errores: validacion.errores,
    };
  }

  return persistir(
    sesion.usuario.id,
    sesion.tenant.id,
    clave,
    validacion.datos,
    nivel,
    texto(datos, 'nota').trim(),
    undefined,
  );
}

/** Guarda una versión nueva desde la vista JSON avanzada. */
export async function guardarConfigJson(
  _previo: ResultadoDeConfig,
  datos: FormData,
): Promise<ResultadoDeConfig> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const clave = texto(datos, 'agente');
  if (agentePorClave(clave) === undefined) return { error: 'Ese agente no está en el registro.' };

  const crudo = texto(datos, 'json');
  let objeto: unknown;
  try {
    objeto = JSON.parse(crudo);
  } catch (error) {
    return { error: `El JSON no se puede leer: ${(error as Error).message}` };
  }

  const validacion = validarConfigDeAgente(objeto);
  if (!validacion.valida || validacion.datos === undefined) {
    return { error: 'El JSON es válido pero la configuración no.', errores: validacion.errores };
  }

  return persistir(
    sesion.usuario.id,
    sesion.tenant.id,
    clave,
    validacion.datos,
    validacion.datos.nivelAutonomia,
    texto(datos, 'nota').trim(),
    undefined,
  );
}

/**
 * Revierte a una versión anterior copiándola en una nueva.
 *
 * El contenido se lee **de la base** y no del formulario: si viniera del
 * navegador, «revertir a la v1» sería «guardar lo que el navegador dice que era
 * la v1», que no es lo mismo y no se puede auditar.
 */
export async function revertirConfig(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const clave = texto(datos, 'agente');
  const version = numero(datos, 'version');
  if (agentePorClave(clave) === undefined || version === undefined) return;

  const tenantId = sesion.tenant.id;

  await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    const origen = await ctx.unaFila<{ config: unknown; nivel_autonomia: string }>(
      `select config, nivel_autonomia from public.agent_configs
       where tenant_id = $1 and agente = $2 and version = $3`,
      [tenantId, clave, version],
    );
    if (origen === undefined) return;

    const nueva = await ctx.unaFila<{ version: number }>(
      `insert into public.agent_configs
         (tenant_id, agente, config, nivel_autonomia, nota, revertida_de, creado_por)
       values ($1, $2, $3::text::jsonb, $4, $5, $6, auth.uid())
       returning version`,
      [
        tenantId,
        clave,
        JSON.stringify(origen.config),
        origen.nivel_autonomia,
        `Revertida desde la versión ${String(version)}`,
        version,
      ],
    );

    await ctx.consultar(
      `select app.registrar_evento($1::uuid, 'config.reverted',
         jsonb_build_object('agente',$2::text,'desde',$3::int,'nueva',$4::int), $2::text, 'panel')`,
      [tenantId, clave, version, nueva?.version ?? 0],
    );
  });

  revalidatePath('/panel/configuracion');
}

/**
 * El parámetro `jsonb` se pasa como texto y se castea `::text::jsonb`.
 *
 * Con `$3::jsonb` a secas y una cadena de JavaScript, postgres.js la vuelve a
 * codificar y en la columna acaba **una cadena de JSON**, no un objeto. Es un
 * fallo que no da error: se guarda, se lee, y solo aparece cuando algo intenta
 * acceder a un campo de dentro. Aquí el síntoma fue una pantalla en blanco con
 * «Cannot read properties of undefined (reading 'desde')» dos pasos más allá.
 *
 * El `::text` intermedio le dice a Postgres que el parámetro es texto y que lo
 * parsee como JSON, que es lo que queríamos. Hay un test en
 * `scripts/src/parametros-jsonb.test.ts` que recorre el repositorio y falla si
 * alguien vuelve a escribir la forma corta.
 */
async function persistir(
  usuarioId: string,
  tenantId: string,
  clave: string,
  config: unknown,
  nivel: string,
  nota: string,
  revertidaDe: number | undefined,
): Promise<ResultadoDeConfig> {
  try {
    const fila = await baseDeDatos().conRLS(usuarioId, async (ctx) => {
      const guardada = await ctx.unaFila<{ version: number }>(
        `insert into public.agent_configs
           (tenant_id, agente, config, nivel_autonomia, nota, revertida_de, creado_por)
         values ($1, $2, $3::text::jsonb, $4, nullif($5, ''), $6, auth.uid())
         returning version`,
        [tenantId, clave, JSON.stringify(config), nivel, nota, revertidaDe ?? null],
      );
      await ctx.consultar(
        `select app.registrar_evento($1::uuid, 'config.published',
           jsonb_build_object('agente',$2::text,'version',$3::int,'nivel',$4::text), $2::text, 'panel')`,
        [tenantId, clave, guardada?.version ?? 0, nivel],
      );
      return guardada;
    });

    revalidatePath('/panel/configuracion');
    return {
      ok: `Guardado como versión ${String(fila?.version ?? 0)}. La anterior sigue en el historial y se puede recuperar.`,
    };
  } catch (error) {
    const mensaje = (error as Error).message;
    if (/row-level security/i.test(mensaje)) {
      return {
        error:
          'Guardar una versión exige ser editor del corporate o más. Como lector puedes verlo todo y proponer cambios.',
      };
    }
    return { error: `No se ha podido guardar: ${mensaje}` };
  }
}
