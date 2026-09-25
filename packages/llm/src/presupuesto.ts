/**
 * El presupuesto, visto desde el router (F2.5, sobre F1.13).
 *
 * El router no sabe dónde vive el presupuesto: en el panel es la base de datos
 * (`app.autorizar_gasto` y `app.liquidar_gasto`, con `for update` para que la
 * concurrencia no lo esquive), en los tests y en las evals es un contador en
 * memoria. Lo que sí sabe es el protocolo, que tiene dos pasos porque el coste
 * de una llamada no se conoce hasta que termina:
 *
 *   1. **autorizar** antes de llamar, reservando el coste **máximo** posible.
 *      Si la reserva no cabe en lo que le queda al tenant, la llamada no se
 *      hace. Eso es cortar de verdad: el presupuesto no se entera después de
 *      que se ha pasado, lo impide antes;
 *   2. **liquidar** después, con el coste real, que libera la reserva y apunta
 *      el gasto en el libro. Se liquida siempre, también cuando la llamada
 *      falla: una reserva que no se libera bloquea presupuesto para nada.
 */

import type { Uso } from './coste.ts';

export type MotivoDeRechazo =
  'sin_presupuesto' | 'presupuesto_agotado' | 'presupuesto_insuficiente';

export type Autorizacion =
  | { readonly permitida: true; readonly reservaId: string }
  | { readonly permitida: false; readonly motivo: MotivoDeRechazo; readonly mensaje: string };

export interface PeticionDeAutorizacion {
  readonly tenantId: string;
  readonly agente: string;
  readonly importeMaximoEur: number;
  readonly referencia: string;
  /**
   * Cuánto dura la reserva si nadie la liquida (un proceso que muere a mitad).
   * Un lote puede tardar horas; una llamada directa, segundos.
   */
  readonly validezSegundos: number;
}

export interface Liquidacion {
  readonly reservaId: string;
  readonly tenantId: string;
  readonly agente: string;
  readonly modelo: string;
  readonly uso: Uso;
  readonly costeEur: number;
  readonly cacheAcertada: boolean;
  readonly modo: 'directo' | 'lote';
  readonly referencia: string;
}

export interface Presupuesto {
  autorizar(peticion: PeticionDeAutorizacion): Promise<Autorizacion>;
  liquidar(liquidacion: Liquidacion): Promise<void>;
}

/**
 * Presupuesto en memoria: para los tests y para las evals.
 *
 * Aplica exactamente las mismas reglas que la base (reserva el máximo, rechaza
 * si no cabe, liquida con el real), para que un test del router que pasa aquí
 * diga algo del comportamiento en producción.
 */
export class PresupuestoEnMemoria implements Presupuesto {
  readonly apuntes: Liquidacion[] = [];
  private readonly reservas = new Map<string, number>();
  private siguiente = 1;

  private readonly limiteEur: number;

  constructor(limiteEur: number) {
    this.limiteEur = limiteEur;
  }

  get gastadoEur(): number {
    return this.apuntes.reduce((total, a) => total + a.costeEur, 0);
  }

  get reservadoEur(): number {
    return [...this.reservas.values()].reduce((total, r) => total + r, 0);
  }

  autorizar(peticion: PeticionDeAutorizacion): Promise<Autorizacion> {
    if (this.limiteEur <= 0) {
      return Promise.resolve({
        permitida: false,
        motivo: 'sin_presupuesto',
        mensaje: 'Sin presupuesto asignado.',
      });
    }
    if (this.gastadoEur >= this.limiteEur) {
      return Promise.resolve({
        permitida: false,
        motivo: 'presupuesto_agotado',
        mensaje: 'Presupuesto agotado.',
      });
    }
    if (this.gastadoEur + this.reservadoEur + peticion.importeMaximoEur > this.limiteEur) {
      return Promise.resolve({
        permitida: false,
        motivo: 'presupuesto_insuficiente',
        mensaje: 'La llamada podría costar más de lo que queda de presupuesto.',
      });
    }
    const reservaId = `reserva_${String(this.siguiente++)}`;
    this.reservas.set(reservaId, peticion.importeMaximoEur);
    return Promise.resolve({ permitida: true, reservaId });
  }

  liquidar(liquidacion: Liquidacion): Promise<void> {
    if (!this.reservas.delete(liquidacion.reservaId)) {
      return Promise.reject(
        new Error(`La reserva ${liquidacion.reservaId} no existe o ya se liquidó.`),
      );
    }
    this.apuntes.push(liquidacion);
    return Promise.resolve();
  }
}
