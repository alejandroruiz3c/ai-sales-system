import { redirect } from 'next/navigation';

import { Etiqueta, Tabla, Tarjeta, Vacio } from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

interface FilaDeEvento {
  id: string;
  nombre: string;
  version: number;
  agente: string;
  origen: string;
  datos: Record<string, unknown>;
  creado_en: string;
  autor: string | null;
  ejecuciones: number;
}

function hora(valor: string): string {
  return new Date(valor).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default async function PaginaDeEventos() {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');

  const tenantId = sesion.tenant.id;
  const eventos = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.consultar<FilaDeEvento>(
      `select e.id, e.nombre, e.version, e.agente, e.origen, e.datos,
              e.creado_en::text as creado_en, p.nombre as autor,
              (select count(*)::int from public.event_runs r where r.event_id = e.id) as ejecuciones
       from public.events e
       left join public.perfiles p on p.id = e.creado_por
       where e.tenant_id = $1
       order by e.creado_en desc
       limit 100`,
      [tenantId],
    ),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Eventos</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          El registro append-only de {sesion.tenant.nombre}. Es la fuente de verdad del sistema, no
          la cola: si el orquestador pierde un evento, el evento sigue aquí y se puede reinyectar
          con <code className="font-mono">pnpm eventos:reproceso</code> (ADR 0002).
        </p>
      </div>

      <Tarjeta
        titulo="Últimos 100"
        descripcion="Nada de esta tabla se puede modificar ni borrar, ni desde el panel ni desde la base."
      >
        {eventos.length === 0 ? (
          <Vacio titulo="Todavía no hay eventos">
            Cada acción del sistema deja uno: crear un corporate, subir un archivo, publicar una
            configuración, cruzar un umbral de presupuesto.
          </Vacio>
        ) : (
          <Tabla cabeceras={['Cuándo', 'Evento', 'Agente', 'Origen', 'Quién', 'Datos']}>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--color-muted)]">
                  {hora(e.creado_en)}
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-white">{e.nombre}</span>
                  <span className="ml-1.5 text-xs text-[var(--color-muted)]">v{e.version}</span>
                  {e.ejecuciones === 0 && (
                    <span
                      className="ml-2"
                      title="Publicado y sin ejecución registrada. Es lo que busca el paso 1 del runbook de reproceso."
                    >
                      <Etiqueta tono="neutro">sin ejecución</Etiqueta>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-muted)]">{e.agente}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-muted)]">{e.origen}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                  {e.autor ?? 'sistema'}
                </td>
                <td className="max-w-md px-3 py-2">
                  <code className="block truncate font-mono text-xs text-[var(--color-muted)]">
                    {JSON.stringify(e.datos)}
                  </code>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </div>
  );
}
