'use client';

import { useActionState } from 'react';

import { guardarDatosDelCorporate } from '@/acciones/ajustes.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada, Etiqueta, Seleccion } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

const ZONAS = [
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Atlantic/Canary',
] as const;

export function FormularioDeDatos({
  nombre,
  slug,
  zona,
  idioma,
  esDemo,
  puedeEditar,
}: {
  nombre: string;
  slug: string;
  zona: string;
  idioma: string;
  esDemo: boolean;
  puedeEditar: boolean;
}) {
  const [estado, accion, enCurso] = useActionState(guardarDatosDelCorporate, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
        <span>
          Dirección: <code className="font-mono text-white">{slug}</code>
        </span>
        {esDemo ? (
          <Etiqueta tono="aviso">corporate de prueba · se puede borrar desde /lab</Etiqueta>
        ) : (
          <Etiqueta tono="ok">corporate real · no se borra desde el panel</Etiqueta>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Nombre">
          <Entrada
            name="nombre"
            defaultValue={nombre}
            required
            minLength={2}
            disabled={!puedeEditar}
            data-testid="ajustes-nombre"
          />
        </Campo>
        <Campo etiqueta="Zona horaria">
          <Seleccion name="zona" defaultValue={zona} disabled={!puedeEditar}>
            {(ZONAS as readonly string[]).includes(zona) ? null : (
              <option value={zona}>{zona}</option>
            )}
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Idioma">
          <Seleccion name="idioma" defaultValue={idioma} disabled={!puedeEditar}>
            <option value="es">Castellano</option>
            <option value="en">Inglés</option>
          </Seleccion>
        </Campo>
      </div>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="ajustes-error">{estado.error}</span>
        </Aviso>
      )}
      {estado.ok !== undefined && (
        <Aviso tono="ok">
          <span data-testid="ajustes-ok">{estado.ok}</span>
        </Aviso>
      )}

      {puedeEditar && (
        <Boton type="submit" disabled={enCurso} data-testid="ajustes-guardar">
          {enCurso ? 'Guardando…' : 'Guardar'}
        </Boton>
      )}
    </form>
  );
}
