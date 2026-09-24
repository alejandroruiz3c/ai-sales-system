'use server';

/**
 * Ajustes del corporate: presupuesto y credenciales (F1.7, F1.13).
 *
 * El presupuesto va por `conRLS`: la política de `tenant_budgets` ya exige
 * administrador, así que un lector rebota en la base.
 *
 * Las credenciales son el caso interesante. La función que las guarda solo la
 * puede ejecutar `service_role`, porque el valor no debe estar al alcance de la
 * sesión de un usuario (F1.7). Eso obliga a un patrón de dos pasos que conviene
 * leer entero antes de tocarlo:
 *
 *   1. **con la sesión del usuario** se comprueba que administra el corporate,
 *      preguntándoselo a la base con `app.puede_administrar`, que resuelve
 *      contra sus pertenencias reales;
 *   2. **solo si la respuesta es sí**, se pasa al camino de sistema para hablar
 *      con Vault.
 *
 * Es exactamente la «capa de servicio obligatoria» que el ADR 0003 admite
 * **además** de RLS, y el sitio donde de verdad hace falta: aquí no hay
 * política que nos cubra, porque el rol que ejecuta se las salta. Por eso el
 * paso 1 no es una comodidad para dar buen mensaje, como en el resto del
 * panel, sino la comprobación que protege.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import { numero, texto } from '../lib/formularios.ts';
import { sesionActual } from '../lib/sesion.ts';
import type { ResultadoDeAccion } from './sesion.ts';

/** Le pregunta a la base si este usuario administra este corporate. */
async function administraDeVerdad(usuarioId: string, tenantId: string): Promise<boolean> {
  const fila = await baseDeDatos().conRLS(usuarioId, (ctx) =>
    ctx.unaFila<{ puede: boolean }>('select app.puede_administrar($1) as puede', [tenantId]),
  );
  return fila?.puede === true;
}

export async function guardarPresupuesto(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const limite = numero(datos, 'limite');
  if (limite === undefined || limite < 0) {
    return { error: 'El presupuesto tiene que ser un número de cero o más.' };
  }
  if (limite > 100_000) {
    return { error: 'Ese presupuesto parece un dedo pegado a una tecla. El máximo son 100.000 €.' };
  }

  const tenantId = sesion.tenant.id;

  try {
    const filas = await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
      const actualizadas = await ctx.consultar<{ tenant_id: string }>(
        `insert into public.tenant_budgets (tenant_id, mes, limite_eur)
         values ($1, date_trunc('month', now())::date, $2::numeric)
         on conflict (tenant_id, mes) do update
           set limite_eur = excluded.limite_eur,
               -- Subir el presupuesto levanta el corte y rearma los avisos
               -- que ya no aplican: si el nuevo límite deja el gasto por
               -- debajo del 50 %, el aviso del 50 % vuelve a tener sentido.
               cortado = app.gasto_del_mes($1) >= excluded.limite_eur,
               avisado_50 = app.gasto_del_mes($1) >= excluded.limite_eur * 0.5,
               avisado_80 = app.gasto_del_mes($1) >= excluded.limite_eur * 0.8
         returning tenant_id`,
        [tenantId, limite],
      );
      if (actualizadas.length > 0) {
        await ctx.consultar(
          `select app.registrar_evento($1::uuid, 'tenant.updated',
             jsonb_build_object('accion','presupuesto','limite_eur',$2::numeric), 'presupuesto', 'panel')`,
          [tenantId, limite],
        );
      }
      return actualizadas;
    });

    if (filas.length === 0) {
      return { error: 'Cambiar el presupuesto exige ser administrador del corporate.' };
    }
  } catch (error) {
    const mensaje = (error as Error).message;
    if (/row-level security/i.test(mensaje)) {
      return { error: 'Cambiar el presupuesto exige ser administrador del corporate.' };
    }
    return { error: `No se ha podido guardar: ${mensaje}` };
  }

  revalidatePath('/panel/ajustes');
  revalidatePath('/panel');
  return { ok: `Presupuesto del mes puesto en ${limite.toFixed(2)} €.` };
}

export async function guardarCredencial(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const nombre = texto(datos, 'nombre').trim().toUpperCase();
  const valor = texto(datos, 'valor');
  const descripcion = texto(datos, 'descripcion').trim();
  const tenantId = sesion.tenant.id;

  if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(nombre)) {
    return {
      error:
        'El nombre va en mayúsculas, con números y guiones bajos, y empieza por una letra. Por ejemplo CRM_API_KEY.',
    };
  }
  if (valor.length === 0) return { error: 'Pega el valor de la credencial.' };

  if (!(await administraDeVerdad(sesion.usuario.id, tenantId))) {
    return { error: 'Guardar una credencial exige ser administrador del corporate.' };
  }

  try {
    await baseDeDatos().comoSistema(
      `Guardar la credencial ${nombre} en Vault: la función solo la puede ejecutar service_role para que el valor no esté al alcance de una sesión de usuario (F1.7)`,
      async (ctx) => {
        await ctx.consultar("select app.guardar_secreto($1::uuid, $2, $3, nullif($4, ''))", [
          tenantId,
          nombre,
          valor,
          descripcion,
        ]);
      },
    );
  } catch (error) {
    const mensaje = (error as Error).message;
    if (mensaje.includes('Vault no está disponible')) {
      return {
        error:
          'Supabase Vault no está disponible en esta base. Un secreto de tenant no se guarda sin cifrar, así que no se ha guardado nada.',
      };
    }
    return { error: `No se ha podido guardar la credencial: ${mensaje}` };
  }

  revalidatePath('/panel/ajustes');
  // El valor no se devuelve, no se registra y no se confirma repitiéndolo: lo
  // único que se dice es que está guardado.
  return {
    ok: `Credencial ${nombre} guardada y cifrada. Su valor ya no se puede volver a leer desde el panel.`,
  };
}

export async function borrarCredencial(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const nombre = texto(datos, 'nombre');
  const tenantId = sesion.tenant.id;

  if (!(await administraDeVerdad(sesion.usuario.id, tenantId))) return;

  await baseDeDatos().comoSistema(
    `Borrar la credencial ${nombre} de Vault a petición de un administrador del corporate`,
    async (ctx) => {
      await ctx.consultar('select app.borrar_secreto($1::uuid, $2)', [tenantId, nombre]);
    },
  );
  revalidatePath('/panel/ajustes');
}

export async function guardarDatosDelCorporate(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const nombre = texto(datos, 'nombre').trim();
  const zona = texto(datos, 'zona', 'Europe/Madrid');
  const idioma = texto(datos, 'idioma', 'es');

  if (nombre.length < 2) return { error: 'El nombre del corporate es obligatorio.' };
  if (idioma !== 'es' && idioma !== 'en') return { error: 'El idioma tiene que ser es o en.' };

  const filas = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.consultar<{ id: string }>(
      `update public.tenants set nombre = $2, zona_horaria = $3, idioma = $4
       where id = $1 returning id`,
      [sesion.tenant?.id, nombre, zona, idioma],
    ),
  );

  if (filas.length === 0) {
    return { error: 'Cambiar los datos del corporate exige ser administrador.' };
  }

  revalidatePath('/panel/ajustes');
  return { ok: 'Guardado.' };
}
