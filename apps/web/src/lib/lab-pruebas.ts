import 'server-only';

/**
 * Las herramientas de la sala de pruebas que F1 tiene que entregar.
 *
 * `/lab` es la habitación del **administrador de plataforma**, no la de un
 * corporate: se entra con la contraseña de plataforma y no con una sesión de
 * Supabase. Eso obliga a usar el camino de sistema, que salta RLS, y por eso
 * aquí hay una regla que no se negocia:
 *
 *   **todo lo que hace `/lab` se limita a corporates marcados `es_demo`.**
 *
 * No es una comodidad, es la frontera. Un corporate real no se toca desde una
 * habitación cuyo control de acceso es una contraseña compartida, y la lista de
 * corporates que `/lab` enseña se filtra en la propia consulta para que no
 * haga falta acordarse de filtrarla después.
 */

import {
  CONFIG_POR_DEFECTO,
  COSTE_POR_LLAMADA_EUR,
  esquemaConfigDePrueba,
  generarAccionDePrueba,
  type ConfigDePrueba,
} from '@sales-os/agent-prueba';

import { baseDeDatos } from './base-de-datos.ts';
import { borrarUsuario, listarUsuarios } from './supabase/admin.ts';

export interface CorporateDePrueba {
  readonly id: string;
  readonly nombre: string;
  readonly slug: string;
  readonly nivelAutonomia: string;
  readonly limiteEur: string;
  readonly gastadoEur: string;
  readonly cortado: boolean;
  readonly pendientes: number;
}

/** Los corporates de prueba, y solo esos. */
export async function corporatesDePrueba(): Promise<readonly CorporateDePrueba[]> {
  const filas = await baseDeDatos().comoSistema(
    'Listar los corporates de prueba para la sala de pruebas: /lab se entra con la contraseña de plataforma y no con una sesión de tenant',
    (ctx) =>
      ctx.consultar<{
        id: string;
        nombre: string;
        slug: string;
        nivel_autonomia: string | null;
        limite_eur: string | null;
        gastado_eur: string;
        cortado: boolean | null;
        pendientes: string;
      }>(
        `select t.id, t.nombre, t.slug,
                (select c.nivel_autonomia from public.agent_configs c
                 where c.tenant_id = t.id and c.agente = 'prueba'
                 order by c.version desc limit 1) as nivel_autonomia,
                b.limite_eur::text as limite_eur,
                app.gasto_del_mes(t.id)::text as gastado_eur,
                b.cortado,
                (select count(*)::text from public.approvals a
                 where a.tenant_id = t.id and a.estado = 'pendiente') as pendientes
         from public.tenants t
         left join public.tenant_budgets b
           on b.tenant_id = t.id and b.mes = date_trunc('month', now())::date
         where t.es_demo = true
         order by t.nombre`,
      ),
  );

  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    slug: f.slug,
    nivelAutonomia: f.nivel_autonomia ?? CONFIG_POR_DEFECTO.nivelAutonomia,
    limiteEur: f.limite_eur ?? '0',
    gastadoEur: f.gastado_eur,
    cortado: f.cortado ?? false,
    pendientes: Number(f.pendientes),
  }));
}

async function esDemo(tenantId: string): Promise<boolean> {
  const fila = await baseDeDatos().comoSistema(
    'Comprobar que el corporate sobre el que va a actuar /lab está marcado como de prueba',
    (ctx) =>
      ctx.unaFila<{ es_demo: boolean }>('select es_demo from public.tenants where id = $1', [
        tenantId,
      ]),
  );
  return fila?.es_demo === true;
}

export interface ResultadoDeCobro {
  readonly permitida: boolean;
  readonly motivo: string;
  readonly mensaje?: string;
  readonly limite_eur: string | number;
  readonly gastado_eur: string | number;
  readonly porcentaje?: string | number | null;
  readonly umbrales_cruzados?: string[];
}

/**
 * Una «llamada LLM de prueba» (caso T1.8).
 *
 * No llama a ningún modelo: en F1 no existe todavía el router de
 * `packages/llm`. Lo que hace es **exactamente lo que hará el router antes de
 * llamar**: pedirle permiso al presupuesto y apuntar el gasto. Probar el corte
 * sin gastar dinero de verdad es lo correcto, y además hace que el caso T1.8
 * sea aritmética exacta y no una estimación.
 */
export async function llamadaLlmDePrueba(tenantId: string): Promise<ResultadoDeCobro> {
  if (!(await esDemo(tenantId))) {
    throw new Error('La sala de pruebas solo actúa sobre corporates de prueba.');
  }

  const fila = await baseDeDatos().comoSistema(
    'Cobrar una llamada LLM de prueba desde la sala de pruebas (T1.8)',
    (ctx) =>
      ctx.unaFila<{ r: ResultadoDeCobro }>(
        `select app.cobrar_llamada($1::uuid, $2::numeric, 'prueba', 'llm', 'simulado-en-f1', 100, 50, 'lab') as r`,
        [tenantId, COSTE_POR_LLAMADA_EUR],
      ),
  );

  if (fila === undefined) throw new Error('El presupuesto no ha respondido');
  return fila.r;
}

export interface ResultadoDeAgente {
  readonly nivel: string;
  readonly destino: string;
  readonly motivo: string;
  readonly contenido: string;
  readonly aprobacionId?: string;
  readonly eventoEmitido?: string;
  readonly cobro: ResultadoDeCobro;
}

/**
 * Ejecuta el agente de prueba con la configuración real del corporate.
 *
 * Cubre dos casos del kit de una vez, y eso es deliberado:
 *
 *   · **T1.7**, porque en nivel L1 el agente deja una aprobación en la cola, y
 *     es la de verdad, no una simulada;
 *   · **T1.9**, porque al bajar el nivel a L0 el mismo botón genera la acción y
 *     **no** la envía, y el resultado lo dice con su motivo.
 *
 * Un botón que creara una aprobación falsa probaría la cola y no probaría el
 * nivel de autonomía, que es la mitad interesante.
 */
export async function ejecutarAgenteDePrueba(
  tenantId: string,
  nota: string,
): Promise<ResultadoDeAgente> {
  if (!(await esDemo(tenantId))) {
    throw new Error('La sala de pruebas solo actúa sobre corporates de prueba.');
  }

  const cobro = await llamadaLlmDePrueba(tenantId);

  return baseDeDatos().comoSistema(
    'Ejecutar el agente de prueba desde la sala de pruebas (T1.7, T1.9)',
    async (ctx) => {
      const vigente = await ctx.unaFila<{ config: unknown; nivel_autonomia: string }>(
        `select config, nivel_autonomia from public.agent_configs
         where tenant_id = $1 and agente = 'prueba' order by version desc limit 1`,
        [tenantId],
      );

      const especifico =
        typeof vigente?.config === 'object' && vigente.config !== null
          ? (vigente.config as { especifico?: unknown; limites?: { porDia?: number } })
          : {};

      const candidata = {
        nivelAutonomia: vigente?.nivel_autonomia ?? CONFIG_POR_DEFECTO.nivelAutonomia,
        tono:
          typeof especifico.especifico === 'object' && especifico.especifico !== null
            ? ((especifico.especifico as { tono?: string }).tono ?? CONFIG_POR_DEFECTO.tono)
            : CONFIG_POR_DEFECTO.tono,
        limiteDiario: especifico.limites?.porDia ?? CONFIG_POR_DEFECTO.limiteDiario,
      };

      const validada = esquemaConfigDePrueba.safeParse(candidata);
      const config: ConfigDePrueba = validada.success ? validada.data : CONFIG_POR_DEFECTO;

      const enviadasHoy = Number(
        (
          await ctx.unaFila<{ n: string }>(
            `select count(*)::text as n from public.events
             where tenant_id = $1 and nombre = 'prueba.accion.enviada'
               and creado_en::date = (now() at time zone 'utc')::date`,
            [tenantId],
          )
        )?.n ?? '0',
      );

      const accion = generarAccionDePrueba({ config, enviadasHoy, nota });

      // El evento de «generada» se publica siempre: el agente ha trabajado,
      // haya salido la acción o no. Es lo que permite ver en el visor que L0
      // genera y no envía, en vez de parecer que no hizo nada.
      await ctx.consultar(
        `select app.registrar_evento($1::uuid, 'prueba.accion.generada',
           jsonb_build_object('nivel', $2::text, 'destino', $3::text, 'motivo', $4::text),
           'prueba', 'lab')`,
        [tenantId, accion.nivel, accion.destino.tipo, accion.destino.motivo],
      );

      let aprobacionId: string | undefined;
      let eventoEmitido: string | undefined;

      if (accion.destino.tipo === 'pedir-aprobacion') {
        const creada = await ctx.unaFila<{ id: string }>(
          `insert into public.approvals
             (tenant_id, agente, tipo, titulo, contenido_propuesto, evento_al_aprobar)
           values ($1, 'prueba', 'accion-de-prueba', $2, jsonb_build_object('texto', $3::text),
                   'prueba.accion.enviada')
           returning id`,
          [tenantId, `Acción de prueba en nivel ${accion.nivel}`, accion.contenido],
        );
        aprobacionId = creada?.id;
        await ctx.consultar(
          `select app.registrar_evento($1::uuid, 'approval.requested',
             jsonb_build_object('approval_id', $2::uuid, 'agente', 'prueba'), 'prueba', 'lab')`,
          [tenantId, aprobacionId],
        );
      } else if (accion.destino.tipo === 'enviar') {
        await ctx.consultar(
          `select app.registrar_evento($1::uuid, 'prueba.accion.enviada',
             jsonb_build_object('contenido', $2::text, 'nivel', $3::text), 'prueba', 'lab')`,
          [tenantId, accion.contenido, accion.nivel],
        );
        eventoEmitido = 'prueba.accion.enviada';
      }

      return {
        nivel: accion.nivel,
        destino: accion.destino.tipo,
        motivo: accion.destino.motivo,
        contenido: accion.contenido,
        ...(aprobacionId === undefined ? {} : { aprobacionId }),
        ...(eventoEmitido === undefined ? {} : { eventoEmitido }),
        cobro,
      };
    },
  );
}

export interface ResultadoDeReset {
  readonly corporatesBorrados: readonly string[];
  readonly usuariosBorrados: number;
  readonly sistemaVacio: boolean;
}

/**
 * Patrón de los usuarios que el reset se puede llevar.
 *
 * Estrecho a propósito: el reset **no borra** a nadie que no encaje aquí. Un
 * botón que borre usuarios necesita una frontera que no dependa de acertar con
 * una condición, y «el correo empieza por `e2e.`» es una frontera que se puede
 * leer de un vistazo.
 */
export const PATRON_DE_USUARIO_DE_PRUEBA = /^e2e[.+-]/i;

/**
 * Deja el sistema como estaba: sin corporates de prueba y sin usuarios de
 * prueba.
 *
 * Es el botón «Reset tenant de pruebas» del plan (§5B.2), y lo que hace posible
 * que el kit se repita entero y que los E2E corran contra staging sin dejar
 * rastro. Tres guardas, y las tres hacen falta:
 *
 *   1. **No corre en producción.** Ni con la contraseña correcta.
 *   2. **Solo borra corporates `es_demo`.** Lo vuelve a comprobar
 *      `app.purgar_tenant_demo`, que se niega con cualquier otro.
 *   3. **Solo borra usuarios cuyo correo empieza por `e2e.`** Quien opera el
 *      sistema no encaja en ese patrón, así que este botón no le puede borrar
 *      la cuenta por mucho que se pulse.
 */
export async function resetDeLaSalaDePruebas(entorno: string): Promise<ResultadoDeReset> {
  if (entorno === 'production') {
    throw new Error('El reset de la sala de pruebas no existe en producción.');
  }

  const borrados = await baseDeDatos().comoSistema(
    'Reset de la sala de pruebas: borrar los corporates de prueba para poder repetir el kit (plan §5B.2)',
    async (ctx) => {
      const demos = await ctx.consultar<{ id: string; nombre: string }>(
        'select id, nombre from public.tenants where es_demo = true order by nombre',
      );
      for (const demo of demos) {
        const secretos = await ctx.consultar<{ nombre: string }>(
          'select nombre from public.tenant_secrets where tenant_id = $1',
          [demo.id],
        );
        for (const secreto of secretos) {
          await ctx.consultar('select app.borrar_secreto($1::uuid, $2)', [demo.id, secreto.nombre]);
        }
        await ctx.consultar('select app.purgar_tenant_demo($1::uuid)', [demo.id]);
      }
      return demos.map((d) => d.nombre);
    },
  );

  const usuarios = await listarUsuarios();
  const dePrueba = usuarios.filter((u) => PATRON_DE_USUARIO_DE_PRUEBA.test(u.email));
  for (const usuario of dePrueba) await borrarUsuario(usuario.id);

  const restante = await baseDeDatos().comoSistema(
    'Comprobar que el reset ha dejado el sistema vacío',
    (ctx) =>
      ctx.unaFila<{ tenants: number; perfiles: number }>(
        `select (select count(*)::int from public.tenants) as tenants,
                (select count(*)::int from public.perfiles) as perfiles`,
      ),
  );

  return {
    corporatesBorrados: borrados,
    usuariosBorrados: dePrueba.length,
    sistemaVacio: (restante?.tenants ?? 1) === 0 && (restante?.perfiles ?? 1) === 0,
  };
}
