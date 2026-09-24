import { redirect } from 'next/navigation';

import { borrarCredencial } from '@/acciones/ajustes.ts';
import { FormularioDeCredencial } from '@/componentes/formulario-de-credencial.tsx';
import { FormularioDeDatos } from '@/componentes/formulario-de-datos.tsx';
import { FormularioDePresupuesto } from '@/componentes/formulario-de-presupuesto.tsx';
import { Aviso, Boton, Etiqueta, Tabla, Tarjeta, Vacio } from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { puedeAdministrar, sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

interface FilaDeSecreto {
  nombre: string;
  descripcion: string | null;
  creado_en: string;
  actualizado_en: string;
  ultimo_uso_en: string | null;
}

interface FilaDePresupuesto {
  limite_eur: string;
  gastado_eur: string;
  cortado: boolean;
  avisado_50: boolean;
  avisado_80: boolean;
}

interface FilaDeTenant {
  nombre: string;
  slug: string;
  zona_horaria: string;
  idioma: string;
  es_demo: boolean;
}

function cuando(valor: string | null): string {
  return valor === null
    ? 'nunca'
    : new Date(valor).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default async function PaginaDeAjustes() {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');

  const tenantId = sesion.tenant.id;
  const administra = puedeAdministrar(sesion.tenant.rol);

  const { tenant, presupuesto, secretos } = await baseDeDatos().conRLS(
    sesion.usuario.id,
    async (ctx) => ({
      tenant: await ctx.unaFila<FilaDeTenant>(
        `select nombre, slug, zona_horaria, idioma, es_demo from public.tenants where id = $1`,
        [tenantId],
      ),
      presupuesto: await ctx.unaFila<FilaDePresupuesto>(
        `select b.limite_eur::text as limite_eur, app.gasto_del_mes($1)::text as gastado_eur,
                b.cortado, b.avisado_50, b.avisado_80
         from public.tenant_budgets b
         where b.tenant_id = $1 and b.mes = date_trunc('month', now())::date`,
        [tenantId],
      ),
      // Solo un administrador puede pedir el inventario: la función lanza
      // excepción con cualquier otro rol, así que para un lector la lista
      // queda vacía y no hay que decidirlo aquí.
      secretos: administra
        ? await ctx
            .consultar<FilaDeSecreto>('select * from app.listar_secretos($1)', [tenantId])
            .catch(() => [])
        : [],
    }),
  );

  if (tenant === undefined) {
    return <Aviso tono="ko">No se ha podido leer este corporate.</Aviso>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Datos, presupuesto y credenciales de {tenant.nombre}.
        </p>
      </div>

      {!administra && (
        <Aviso tono="neutro" titulo="Estás como lector o editor">
          Ves los datos y el presupuesto. Cambiarlos y ver el inventario de credenciales exige ser
          administrador del corporate.
        </Aviso>
      )}

      <Tarjeta titulo="El corporate">
        <FormularioDeDatos
          nombre={tenant.nombre}
          slug={tenant.slug}
          zona={tenant.zona_horaria}
          idioma={tenant.idioma}
          esDemo={tenant.es_demo}
          puedeEditar={administra}
        />
      </Tarjeta>

      <Tarjeta
        titulo="Presupuesto de modelos"
        descripcion="Por mes. Avisos al 50 % y al 80 %, y corte duro al 100 %. Un corporate a cero no ejecuta ninguna llamada."
      >
        <FormularioDePresupuesto
          limite={presupuesto?.limite_eur ?? '0'}
          gastado={presupuesto?.gastado_eur ?? '0'}
          cortado={presupuesto?.cortado ?? false}
          avisado50={presupuesto?.avisado_50 ?? false}
          avisado80={presupuesto?.avisado_80 ?? false}
          puedeEditar={administra}
        />
      </Tarjeta>

      {administra && (
        <Tarjeta
          titulo="Credenciales del corporate"
          descripcion="Se guardan cifradas en Supabase Vault. Su valor no vuelve al panel: la función que lo lee solo la puede ejecutar el servidor."
        >
          <div className="space-y-5">
            <Aviso tono="acento" titulo="Por qué no puedes volver a ver un valor">
              No es una molestia de diseño: la tabla de credenciales no concede ni un privilegio al
              rol con el que habla este panel, y la función que descifra el valor solo la puede
              ejecutar el servidor. Así, un endpoint escrito con prisa no puede filtrar lo que su
              conexión no puede leer. Si pierdes una credencial, se sustituye por otra.
            </Aviso>

            {secretos.length === 0 ? (
              <Vacio titulo="Sin credenciales todavía">
                Aquí irán las claves de las conexiones de este corporate: su CRM, su buzón, su línea
                de voz. Las conexiones de verdad llegan en F4.
              </Vacio>
            ) : (
              <Tabla cabeceras={['Nombre', 'Descripción', 'Guardada', 'Último uso', '']}>
                {secretos.map((s) => (
                  <tr key={s.nombre}>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs text-white">{s.nombre}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">
                      {s.descripcion ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">
                      {cuando(s.creado_en)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {s.ultimo_uso_en === null ? (
                        <Etiqueta>nunca</Etiqueta>
                      ) : (
                        <span className="text-[var(--color-muted)]">{cuando(s.ultimo_uso_en)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <form action={borrarCredencial}>
                        <input type="hidden" name="nombre" value={s.nombre} />
                        <Boton variante="discreto" type="submit" className="px-2 text-xs">
                          Borrar
                        </Boton>
                      </form>
                    </td>
                  </tr>
                ))}
              </Tabla>
            )}

            <div className="border-t border-[var(--color-line)] pt-5">
              <FormularioDeCredencial />
            </div>
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
