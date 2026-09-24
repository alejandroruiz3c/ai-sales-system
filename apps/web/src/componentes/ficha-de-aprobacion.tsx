'use client';

import { useActionState, useState } from 'react';

import { resolverAprobacion } from '@/acciones/aprobaciones.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, AreaDeTexto, Boton, Etiqueta } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

interface Aprobacion {
  id: string;
  agente: string;
  tipo: string;
  titulo: string;
  contenido_propuesto: { texto?: string } & Record<string, unknown>;
  evento_al_aprobar: string | null;
  creada_en: string;
}

export function FichaDeAprobacion({
  aprobacion,
  puedeEditar,
}: {
  aprobacion: Aprobacion;
  puedeEditar: boolean;
}) {
  const [estado, accion, enCurso] = useActionState(resolverAprobacion, INICIAL);
  const propuesto =
    aprobacion.contenido_propuesto.texto ?? JSON.stringify(aprobacion.contenido_propuesto);
  const [contenido, setContenido] = useState(propuesto);
  const editado = contenido.trim() !== propuesto.trim();

  return (
    <form
      action={accion}
      className="rounded-md border border-[var(--color-line)] px-4 py-4"
      data-testid={`aprobacion-${aprobacion.id}`}
    >
      <input type="hidden" name="id" value={aprobacion.id} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-white">{aprobacion.titulo}</span>
        <Etiqueta>{aprobacion.agente}</Etiqueta>
        <Etiqueta>{aprobacion.tipo}</Etiqueta>
        {aprobacion.evento_al_aprobar !== null && (
          <span className="text-xs text-[var(--color-muted)]">
            al aprobar emite{' '}
            <code className="font-mono text-white">{aprobacion.evento_al_aprobar}</code>
          </span>
        )}
      </div>

      <div className="mt-3">
        <label className="text-xs font-medium text-[var(--color-muted)]">
          Lo que propone el agente{' '}
          {editado && <span className="text-[var(--color-warn)]">· editado</span>}
        </label>
        <AreaDeTexto
          name="contenido"
          rows={4}
          value={contenido}
          onChange={(e) => {
            setContenido(e.target.value);
          }}
          disabled={!puedeEditar}
          className="mt-1.5"
          data-testid="aprobacion-contenido"
        />
        {editado && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--color-muted)]">
              Ver lo que proponía antes de tu edición
            </summary>
            <pre className="mt-1.5 whitespace-pre-wrap rounded border border-[var(--color-line)] bg-[var(--color-ink)] p-3 font-mono text-xs text-[var(--color-muted)]">
              {propuesto}
            </pre>
          </details>
        )}
      </div>

      {estado.error !== undefined && (
        <div className="mt-3">
          <Aviso tono="ko">
            <span data-testid="aprobacion-error">{estado.error}</span>
          </Aviso>
        </div>
      )}
      {puedeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Boton
            type="submit"
            name="decision"
            value="aprobada"
            disabled={enCurso}
            data-testid="aprobacion-aprobar"
          >
            {editado ? 'Aprobar con mi edición' : 'Aprobar'}
          </Boton>
          <Boton
            variante="peligro"
            type="submit"
            name="decision"
            value="rechazada"
            disabled={enCurso}
            data-testid="aprobacion-rechazar"
          >
            Rechazar
          </Boton>
        </div>
      )}
    </form>
  );
}
