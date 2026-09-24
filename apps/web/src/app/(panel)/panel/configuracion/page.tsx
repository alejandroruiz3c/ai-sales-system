import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { ConfigDeAgente } from '@sales-os/db';

import { EditorDeConfig } from '@/componentes/editor-de-config.tsx';
import { HistorialDeConfig } from '@/componentes/historial-de-config.tsx';
import { Aviso, Etiqueta, Tarjeta } from '@/componentes/ui/index.tsx';
import { AGENTES_DEL_PANEL, agentePorClave } from '@/lib/agentes.ts';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { puedeEditar, sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

interface FilaDeVersion {
  version: number;
  config: ConfigDeAgente;
  nivel_autonomia: string;
  nota: string | null;
  revertida_de: number | null;
  creado_en: string;
  autor: string | null;
}

export default async function PaginaDeConfiguracion({
  searchParams,
}: {
  searchParams: Promise<{ agente?: string }>;
}) {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');

  const { agente: pedido } = await searchParams;
  const agente = agentePorClave(pedido ?? '') ?? AGENTES_DEL_PANEL[0];
  if (agente === undefined) return <Aviso tono="ko">No hay agentes en el registro.</Aviso>;

  const tenantId = sesion.tenant.id;
  const edita = puedeEditar(sesion.tenant.rol);

  const versiones = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.consultar<FilaDeVersion>(
      `select c.version, c.config, c.nivel_autonomia, c.nota, c.revertida_de,
              c.creado_en::text as creado_en, p.nombre as autor
       from public.agent_configs c
       left join public.perfiles p on p.id = c.creado_por
       where c.tenant_id = $1 and c.agente = $2
       order by c.version desc`,
      [tenantId, agente.clave],
    ),
  );

  const vigente = versiones[0];
  const config = vigente?.config ?? agente.configInicial;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Cada cambio guarda una versión nueva. Revertir no deshace: copia una versión anterior en
          otra nueva, así que el historial no tiene huecos.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {AGENTES_DEL_PANEL.map((a) => (
          <Link
            key={a.clave}
            href={`/panel/configuracion?agente=${a.clave}`}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              a.clave === agente.clave
                ? 'border-[var(--color-accent)] text-white'
                : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-white'
            }`}
            data-testid={`pestana-${a.clave}`}
          >
            {a.nombre}
          </Link>
        ))}
      </nav>

      <Tarjeta
        titulo={agente.nombre}
        descripcion={agente.resumen}
        acciones={
          <Etiqueta tono={agente.fase === 'F1' ? 'ok' : 'neutro'}>
            {agente.fase === 'F1' ? 'operativo' : `el agente llega en ${agente.fase}`}
          </Etiqueta>
        }
      >
        {agente.fase !== 'F1' && (
          <div className="mb-5">
            <Aviso tono="acento" titulo="Se configura ahora y se usa después">
              Este agente todavía no existe: llega en {agente.fase}. Lo que F1 entrega es que su
              configuración se pueda guardar, versionar y revertir **antes** de que exista quien la
              lea. Ese orden es el correcto: un agente que llega y no se puede configurar no está
              terminado.
            </Aviso>
          </div>
        )}

        {!edita && (
          <div className="mb-5">
            <Aviso tono="neutro" titulo="Estás como lector">
              Lo ves todo y no puedes guardar. En F2B podrás proponer un cambio y quedará pendiente
              de que alguien lo apruebe.
            </Aviso>
          </div>
        )}

        <EditorDeConfig
          agente={agente.clave}
          config={config}
          version={vigente?.version ?? 0}
          puedeEditar={edita}
        />
      </Tarjeta>

      <Tarjeta
        titulo="Historial"
        descripcion={`${String(versiones.length)} ${versiones.length === 1 ? 'versión' : 'versiones'} guardadas`}
      >
        <HistorialDeConfig agente={agente.clave} versiones={versiones} puedeEditar={edita} />
      </Tarjeta>
    </div>
  );
}
