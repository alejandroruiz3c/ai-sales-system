'use server';

/**
 * Resolver aprobaciones (F1.11, caso T1.7).
 *
 * Aprobar **emite el evento que la aprobación llevaba anotado**. Es el enganche
 * entre la cola humana y el bus: hasta que alguien aprueba, el evento de la
 * acción no existe, y por tanto la acción no ha ocurrido. Eso es lo que hace
 * que el nivel L1 signifique algo.
 *
 * Toda la lógica está en `app.resolver_aprobacion`, en la base, y no aquí. No
 * es por gusto por el SQL: emitir el evento, apuntar quién aprobó y marcar si
 * hubo edición tienen que pasar en la misma transacción. Repartido entre
 * TypeScript y SQL, un fallo a mitad deja una aprobación aprobada cuyo evento
 * no se publicó, que es la clase de incoherencia que después nadie encuentra.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { texto } from '../lib/formularios.ts';
import { sesionActual } from '../lib/sesion.ts';
import type { ResultadoDeAccion } from './sesion.ts';

export async function resolverAprobacion(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const id = texto(datos, 'id');
  const decision = texto(datos, 'decision');
  const editado = texto(datos, 'contenido');
  const motivo = texto(datos, 'motivo').trim();

  if (decision !== 'aprobada' && decision !== 'rechazada') {
    return { error: 'Una aprobación se resuelve como aprobada o rechazada.' };
  }

  // El contenido editado llega como texto plano y se guarda en la misma forma
  // que la propuesta: `{ texto: … }`. Cuando los agentes de F5 en adelante
  // propongan estructuras más ricas, el Estudio (F2B) enseñará su propio
  // editor; hasta entonces, un `textarea` es honesto y suficiente.
  const contenido = editado.trim() === '' ? null : JSON.stringify({ texto: editado });

  let editada: boolean;

  try {
    const fila = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
      ctx.unaFila<{ r: { estado: string; editada: boolean; evento_emitido_id: string | null } }>(
        "select app.resolver_aprobacion($1, $2, $3::text::jsonb, nullif($4, '')) as r",
        [id, decision, contenido, motivo],
      ),
    );

    revalidatePath('/panel');

    if (fila === undefined) return { error: 'No se ha podido resolver.' };
    editada = fila.r.editada;
  } catch (error) {
    const mensaje = (error as Error).message;
    if (/row-level security|no encontrada/i.test(mensaje)) {
      return { error: 'Resolver una aprobación exige ser editor del corporate o más.' };
    }
    if (mensaje.includes('ya está')) return { error: 'Esta aprobación ya estaba resuelta.' };
    return { error: `No se ha podido resolver: ${mensaje}` };
  }

  /**
   * En vez de devolver un mensaje de éxito, se redirige con el resultado en la
   * URL. El motivo es concreto: al resolver, la aprobación deja de estar
   * pendiente y **su tarjeta desaparece de la lista**, llevándose consigo
   * cualquier mensaje que estuviera dentro. Quien acaba de aprobar algo se
   * quedaba sin ver qué ha pasado, que es justo lo contrario de lo que hace
   * falta después de una decisión.
   *
   * El aviso se pinta arriba, fuera de la lista, donde no lo puede borrar el
   * siguiente renderizado.
   */
  redirect(`/panel/aprobaciones?resuelta=${decision}${editada ? '&editada=1' : ''}`);
}
