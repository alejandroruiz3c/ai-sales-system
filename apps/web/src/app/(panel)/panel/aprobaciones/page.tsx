import Link from 'next/link';
import { redirect } from 'next/navigation';

import { FichaDeAprobacion } from '@/componentes/ficha-de-aprobacion.tsx';
import { Aviso, Etiqueta, Tarjeta, Vacio } from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { puedeEditar, sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

export interface FilaDeAprobacion {
  id: string;
  agente: string;
  tipo: string;
  titulo: string;
  estado: string;
  contenido_propuesto: { texto?: string } & Record<string, unknown>;
  contenido_final: ({ texto?: string } & Record<string, unknown>) | null;
  editada: boolean;
  motivo: string | null;
  evento_al_aprobar: string | null;
  creada_en: string;
  resuelta_en: string | null;
  resuelta_por_nombre: string | null;
}

export default async function PaginaDeAprobaciones({
  searchParams,
}: {
  searchParams: Promise<{ resuelta?: string; editada?: string }>;
}) {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');
  const { resuelta, editada } = await searchParams;

  const tenantId = sesion.tenant.id;
  const edita = puedeEditar(sesion.tenant.rol);

  const filas = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.consultar<FilaDeAprobacion>(
      `select a.id, a.agente, a.tipo, a.titulo, a.estado, a.contenido_propuesto,
              a.contenido_final, a.editada, a.motivo, a.evento_al_aprobar,
              a.creada_en::text as creada_en, a.resuelta_en::text as resuelta_en,
              p.nombre as resuelta_por_nombre
       from public.approvals a
       left join public.perfiles p on p.id = a.resuelta_por
       where a.tenant_id = $1
       order by (a.estado = 'pendiente') desc, a.creada_en desc
       limit 50`,
      [tenantId],
    ),
  );

  const pendientes = filas.filter((a) => a.estado === 'pendiente');
  const resueltas = filas.filter((a) => a.estado !== 'pendiente');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Aprobaciones</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Lo que un agente propone y espera a que una persona lo mire. Hasta que apruebas, el evento
          de la acción no existe, así que la acción no ha ocurrido.
        </p>
      </div>

      {resuelta === 'aprobada' && (
        <Aviso tono="ok" titulo="Aprobada">
          <span data-testid="aprobacion-ok">
            {editada === '1'
              ? 'Aprobada con tu edición. El evento se ha emitido con el texto que has escrito.'
              : 'Aprobada tal cual. El evento se ha emitido con el texto que propuso el agente.'}
          </span>
        </Aviso>
      )}
      {resuelta === 'rechazada' && (
        <Aviso tono="neutro" titulo="Rechazada">
          <span data-testid="aprobacion-ok">
            No se ha emitido el evento de la acción, así que no ha pasado nada.
          </span>
        </Aviso>
      )}

      {!edita && (
        <Aviso tono="neutro" titulo="Estás como lector">
          Ves la cola y no puedes resolver nada. Lo decide la política de la tabla.
        </Aviso>
      )}

      <Tarjeta
        titulo={`Pendientes · ${String(pendientes.length)}`}
        descripcion="Puedes aprobar tal cual, editar antes de aprobar, o rechazar."
      >
        {pendientes.length === 0 ? (
          <Vacio titulo="Nada pendiente">
            Cuando un agente en nivel L1 proponga algo, aparecerá aquí. Para probarlo ahora, la{' '}
            <Link href="/lab" className="text-[var(--color-accent)] underline">
              sala de pruebas
            </Link>{' '}
            crea una aprobación de prueba.
          </Vacio>
        ) : (
          <div className="space-y-4">
            {pendientes.map((a) => (
              <FichaDeAprobacion key={a.id} aprobacion={a} puedeEditar={edita} />
            ))}
          </div>
        )}
      </Tarjeta>

      {resueltas.length > 0 && (
        <Tarjeta titulo="Resueltas" descripcion="Con quién la resolvió y si la editó.">
          <ul className="divide-y divide-[var(--color-line)]">
            {resueltas.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <Etiqueta tono={a.estado === 'aprobada' ? 'ok' : 'ko'}>{a.estado}</Etiqueta>
                {a.editada && <Etiqueta tono="acento">editada</Etiqueta>}
                <span className="text-sm text-white">{a.titulo}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {a.agente} · {a.resuelta_por_nombre ?? 'sistema'}
                  {a.resuelta_en === null
                    ? ''
                    : ` · ${new Date(a.resuelta_en).toLocaleString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`}
                </span>
                {a.motivo !== null && (
                  <span className="text-xs text-[var(--color-muted)]">· {a.motivo}</span>
                )}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  );
}
