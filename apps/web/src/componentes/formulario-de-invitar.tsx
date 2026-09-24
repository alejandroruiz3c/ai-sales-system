'use client';

import { useActionState } from 'react';

import { invitarPersona, type ResultadoDeInvitacion } from '@/acciones/corporates.ts';
import { DESCRIPCION_DE_ROL, ETIQUETA_DE_ROL, type Rol } from '@/lib/sesion.ts';

import { Aviso, Boton, Campo, Entrada, Seleccion } from './ui/index.tsx';

const INICIAL: ResultadoDeInvitacion = {};
const INVITABLES: readonly Rol[] = ['administrador', 'editor', 'lector'];

export function FormularioDeInvitar() {
  const [estado, accion, enCurso] = useActionState(invitarPersona, INICIAL);

  return (
    <div className="space-y-4">
      <form action={accion} className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <Campo etiqueta="Correo">
          <Entrada name="email" type="email" required data-testid="invitar-email" />
        </Campo>

        <Campo etiqueta="Rol">
          <Seleccion name="rol" defaultValue="lector" data-testid="invitar-rol">
            {INVITABLES.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_DE_ROL[r]}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Boton type="submit" disabled={enCurso} data-testid="invitar-enviar">
          {enCurso ? 'Creando…' : 'Crear invitación'}
        </Boton>
      </form>

      <p className="text-xs text-[var(--color-muted)]">
        {INVITABLES.map(
          (r) => `${ETIQUETA_DE_ROL[r]}: ${DESCRIPCION_DE_ROL[r].toLowerCase()}`,
        ).join(' · ')}
      </p>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="invitar-error">{estado.error}</span>
        </Aviso>
      )}

      {estado.enlace !== undefined && (
        <Aviso tono="ok" titulo="Invitación creada">
          <p>{estado.ok}</p>
          <code
            data-testid="invitar-enlace"
            className="mt-2 block break-all rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-xs text-white"
          >
            {estado.enlace}
          </code>
        </Aviso>
      )}
    </div>
  );
}
