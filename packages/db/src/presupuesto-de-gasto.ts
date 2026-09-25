/**
 * El presupuesto del router, sobre la base (F2.5).
 *
 * Implementa la interfaz `Presupuesto` de `@sales-os/llm` con las dos
 * funciones de la migración 0010: `app.autorizar_gasto` reserva el coste
 * máximo antes de llamar y `app.liquidar_gasto` apunta el real después. La
 * regla de corte y la serialización (`for update`) están en la base, no aquí:
 * este fichero solo traduce.
 *
 * Quién ejecuta lo decide quien lo construye, porque hay dos casos y los dos
 * son legítimos:
 *
 *   · **como sistema**, para lo que corre sin sesión de usuario: funciones de
 *     Inngest y la sala de pruebas, que se entra con la contraseña de
 *     plataforma;
 *   · **con RLS**, para lo que hace un usuario desde el panel (la pestaña
 *     Probar del Estudio, F2B.6). Entonces reservar en el presupuesto de un
 *     corporate del que no es miembro falla en la base, no aquí.
 */

import type {
  Autorizacion,
  Liquidacion,
  MotivoDeRechazo,
  PeticionDeAutorizacion,
  Presupuesto,
} from '@sales-os/llm';

import type { Contexto } from './cliente.ts';

/** Lo único que el presupuesto necesita de una conexión: SQL parametrizado. */
export type ConsultaSql = Pick<Contexto, 'consultar' | 'unaFila'>;

export type Ejecutor = <T>(fn: (ctx: ConsultaSql) => Promise<T>) => Promise<T>;

interface RespuestaDeAutorizacion {
  readonly permitida: boolean;
  readonly motivo: string;
  readonly mensaje?: string;
  readonly reserva_id?: string;
}

const MOTIVOS: readonly MotivoDeRechazo[] = [
  'sin_presupuesto',
  'presupuesto_agotado',
  'presupuesto_insuficiente',
];

function esMotivo(motivo: string): motivo is MotivoDeRechazo {
  return (MOTIVOS as readonly string[]).includes(motivo);
}

export function crearPresupuestoDeGasto(ejecutar: Ejecutor): Presupuesto {
  return {
    async autorizar(peticion: PeticionDeAutorizacion): Promise<Autorizacion> {
      const fila = await ejecutar((ctx) =>
        ctx.unaFila<{ r: RespuestaDeAutorizacion }>(
          'select app.autorizar_gasto($1::uuid, $2::numeric, $3, $4, $5::integer) as r',
          [
            peticion.tenantId,
            peticion.importeMaximoEur,
            peticion.agente,
            peticion.referencia,
            peticion.validezSegundos,
          ],
        ),
      );
      const r = fila?.r;
      if (r === undefined) throw new Error('El presupuesto no ha respondido.');
      if (r.permitida && r.reserva_id !== undefined)
        return { permitida: true, reservaId: r.reserva_id };
      if (!esMotivo(r.motivo)) {
        throw new Error(`El presupuesto ha respondido un motivo desconocido: ${r.motivo}`);
      }
      return {
        permitida: false,
        motivo: r.motivo,
        mensaje: r.mensaje ?? 'Sin presupuesto.',
      };
    },

    async liquidar(l: Liquidacion): Promise<void> {
      await ejecutar((ctx) =>
        ctx.consultar(
          `select app.liquidar_gasto($1::uuid, $2::numeric, $3, $4::integer, $5::integer,
                                     $6::integer, $7::integer, $8::boolean, $9, $10)`,
          [
            l.reservaId,
            l.costeEur,
            l.modelo,
            l.uso.entrada,
            l.uso.salida,
            l.uso.cacheLeida,
            l.uso.cacheEscrita,
            l.cacheAcertada,
            l.modo,
            l.referencia,
          ],
        ),
      );
    },
  };
}
