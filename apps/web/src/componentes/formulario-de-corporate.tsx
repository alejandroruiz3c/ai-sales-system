'use client';

import { useActionState } from 'react';

import { crearCorporate } from '@/acciones/corporates.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada, Seleccion } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

/** Las zonas que hacen falta hoy. La lista completa llega cuando haga falta. */
const ZONAS = [
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Atlantic/Canary',
] as const;

export function FormularioDeCorporate() {
  const [estado, accion, enCurso] = useActionState(crearCorporate, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <Campo
        etiqueta="Nombre del corporate"
        ayuda="Como lo llamáis vosotros. Se puede cambiar después."
      >
        <Entrada name="nombre" required minLength={2} data-testid="corporate-nombre" />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Zona horaria" ayuda="Manda para las ventanas de envío.">
          <Seleccion name="zona" defaultValue="Europe/Madrid" data-testid="corporate-zona">
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Campo etiqueta="Idioma">
          <Seleccion name="idioma" defaultValue="es" data-testid="corporate-idioma">
            <option value="es">Castellano</option>
            <option value="en">Inglés</option>
          </Seleccion>
        </Campo>
      </div>

      <Campo
        etiqueta="Presupuesto mensual de modelos (€)"
        ayuda="Avisos al 50 % y al 80 %, y corte al 100 %. Un corporate a cero no ejecuta ninguna llamada."
      >
        <Entrada
          name="presupuesto"
          type="number"
          min="0"
          step="0.01"
          defaultValue="5"
          data-testid="corporate-presupuesto"
        />
      </Campo>

      <label className="flex items-start gap-3 rounded-md border border-[var(--color-line)] px-4 py-3">
        <input
          type="checkbox"
          name="esDemo"
          defaultChecked
          data-testid="corporate-demo"
          className="mt-0.5"
        />
        <span className="text-sm">
          <span className="font-medium text-white">Es un corporate de prueba</span>
          <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
            Los de prueba se pueden borrar enteros desde la sala de pruebas. Los reales no: hay que
            hacerlo a mano en la base, y esa fricción es a propósito.
          </span>
        </span>
      </label>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="corporate-error">{estado.error}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} data-testid="corporate-crear">
        {enCurso ? 'Creando…' : 'Crear corporate'}
      </Boton>
    </form>
  );
}
