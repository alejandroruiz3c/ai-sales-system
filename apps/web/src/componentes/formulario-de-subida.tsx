'use client';

import { useActionState } from 'react';

import { subirArchivo } from '@/acciones/archivos.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada, Seleccion } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

const ACEPTADOS = '.pdf,.pptx,.docx,.xlsx,.txt,.md,.csv,.json';

export function FormularioDeSubida() {
  const [estado, accion, enCurso] = useActionState(subirArchivo, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Campo etiqueta="Carpeta">
          <Seleccion name="carpeta" defaultValue="context" data-testid="subir-carpeta">
            <option value="context">context/</option>
            <option value="inputs">inputs/</option>
            <option value="outputs">outputs/</option>
          </Seleccion>
        </Campo>

        <Campo etiqueta="Archivo" ayuda="PDF, PPTX, DOCX, XLSX, TXT, MD, CSV o JSON. Hasta 50 MB.">
          <Entrada
            type="file"
            name="archivo"
            accept={ACEPTADOS}
            required
            data-testid="subir-archivo"
            className="file:mr-3 file:rounded file:border-0 file:bg-[var(--color-line)] file:px-3 file:py-1 file:text-xs file:text-white"
          />
        </Campo>
      </div>

      <Campo etiqueta="Descripción (opcional)" ayuda="Para que el resto del equipo sepa qué es.">
        <Entrada name="descripcion" maxLength={200} data-testid="subir-descripcion" />
      </Campo>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="subir-error">{estado.error}</span>
        </Aviso>
      )}
      {estado.ok !== undefined && (
        <Aviso tono="ok">
          <span data-testid="subir-ok">{estado.ok}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} data-testid="subir-enviar">
        {enCurso ? 'Subiendo…' : 'Subir'}
      </Boton>
    </form>
  );
}
