'use client';

import { useActionState } from 'react';

import { guardarCredencial } from '@/acciones/ajustes.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

export function FormularioDeCredencial() {
  const [estado, accion, enCurso] = useActionState(guardarCredencial, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <p className="text-sm font-medium text-white">Guardar una credencial</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre" ayuda="En mayúsculas, con guiones bajos. Por ejemplo CRM_API_KEY.">
          <Entrada
            name="nombre"
            required
            pattern="[A-Za-z][A-Za-z0-9_]{2,60}"
            data-testid="credencial-nombre"
          />
        </Campo>

        <Campo etiqueta="Valor" ayuda="Se cifra al guardarlo y no se vuelve a mostrar.">
          <Entrada
            name="valor"
            type="password"
            required
            autoComplete="off"
            data-testid="credencial-valor"
          />
        </Campo>
      </div>

      <Campo etiqueta="Para qué es (opcional)">
        <Entrada name="descripcion" maxLength={200} data-testid="credencial-descripcion" />
      </Campo>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="credencial-error">{estado.error}</span>
        </Aviso>
      )}
      {estado.ok !== undefined && (
        <Aviso tono="ok">
          <span data-testid="credencial-ok">{estado.ok}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} data-testid="credencial-guardar">
        {enCurso ? 'Cifrando…' : 'Guardar credencial'}
      </Boton>
    </form>
  );
}
