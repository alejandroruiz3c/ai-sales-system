'use client';

import { useActionState } from 'react';

import { guardarPresupuesto } from '@/acciones/ajustes.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada, Etiqueta } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

export function FormularioDePresupuesto({
  limite,
  gastado,
  cortado,
  avisado50,
  avisado80,
  puedeEditar,
}: {
  limite: string;
  gastado: string;
  cortado: boolean;
  avisado50: boolean;
  avisado80: boolean;
  puedeEditar: boolean;
}) {
  const [estado, accion, enCurso] = useActionState(guardarPresupuesto, INICIAL);
  const n = (valor: string): number => Number(valor);
  const porcentaje = n(limite) > 0 ? (n(gastado) / n(limite)) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold text-white" data-testid="gastado">
          {n(gastado).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €
        </span>
        <span className="text-sm text-[var(--color-muted)]">
          de {n(limite).toLocaleString('es-ES', { maximumFractionDigits: 2 })} € este mes
        </span>
        {cortado && <Etiqueta tono="ko">cortado al 100 %</Etiqueta>}
        {!cortado && avisado80 && <Etiqueta tono="aviso">pasado el 80 %</Etiqueta>}
        {!cortado && !avisado80 && avisado50 && <Etiqueta tono="aviso">pasado el 50 %</Etiqueta>}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-ink)]">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${String(Math.min(100, porcentaje))}%`,
            background:
              porcentaje >= 100
                ? 'var(--color-ko)'
                : porcentaje >= 80
                  ? 'var(--color-warn)'
                  : 'var(--color-ok)',
          }}
        />
      </div>

      {cortado && (
        <Aviso tono="ko" titulo="Las llamadas a modelo están bloqueadas">
          Amplía el presupuesto para reanudarlas. Al ampliarlo se levanta el corte y los avisos se
          recolocan según el límite nuevo.
        </Aviso>
      )}

      {puedeEditar && (
        <form action={accion} className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Límite del mes (€)">
            <Entrada
              name="limite"
              type="number"
              min="0"
              step="0.01"
              defaultValue={limite}
              className="w-40"
              data-testid="presupuesto-limite"
            />
          </Campo>
          <Boton type="submit" disabled={enCurso} data-testid="presupuesto-guardar">
            {enCurso ? 'Guardando…' : 'Guardar'}
          </Boton>
        </form>
      )}

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="presupuesto-error">{estado.error}</span>
        </Aviso>
      )}
      {estado.ok !== undefined && (
        <Aviso tono="ok">
          <span data-testid="presupuesto-ok">{estado.ok}</span>
        </Aviso>
      )}
    </div>
  );
}
