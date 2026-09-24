'use client';

import { useState } from 'react';

import { Aviso, Boton } from './ui/index.tsx';

interface Resultado {
  corporatesBorrados?: string[];
  usuariosBorrados?: number;
  sistemaVacio?: boolean;
  error?: string;
}

/**
 * «Reset tenant de pruebas» (plan §5B.2).
 *
 * Pide confirmación escribiendo la palabra `RESET`. No es teatro: este botón
 * borra corporates enteros y usuarios, y en staging lo va a pulsar alguien que
 * lleva media hora haciendo el kit. Un clic accidental le costaría repetirlo
 * todo.
 */
export function ResetDePruebas() {
  const [confirmacion, setConfirmacion] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  async function ejecutar(): Promise<void> {
    setEnCurso(true);
    setResultado(null);
    const respuesta = await fetch('/api/lab/reset', { method: 'POST' });
    setResultado((await respuesta.json()) as Resultado);
    setConfirmacion('');
    setEnCurso(false);
  }

  return (
    <div className="space-y-4">
      <Aviso tono="aviso" titulo="Qué borra exactamente">
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            Todos los corporates marcados <strong>de prueba</strong>, con sus archivos, su
            configuración, sus eventos y sus credenciales.
          </li>
          <li>
            Los usuarios cuyo correo empieza por <code className="font-mono">e2e.</code>, que son
            los que crean los tests.
          </li>
        </ul>
        <p className="mt-2">
          No toca ningún corporate real ni ninguna cuenta de persona: un corporate real no se borra
          desde un botón, y tu cuenta no encaja en ese patrón de correo. Y en producción esto no
          existe.
        </p>
      </Aviso>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium text-white">Escribe RESET para confirmar</span>
          <input
            value={confirmacion}
            onChange={(e) => {
              setConfirmacion(e.target.value);
            }}
            data-testid="reset-confirmacion"
            className="mt-1.5 w-40 rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-sm text-white outline-none focus:border-[var(--color-ko)]"
          />
        </label>
        <Boton
          variante="peligro"
          type="button"
          onClick={() => void ejecutar()}
          disabled={confirmacion !== 'RESET' || enCurso}
          data-testid="reset-ejecutar"
        >
          {enCurso ? 'Borrando…' : 'Reset del entorno de pruebas'}
        </Boton>
      </div>

      {resultado !== null && (
        <Aviso tono={resultado.error === undefined ? 'ok' : 'ko'}>
          <span data-testid="reset-resultado">
            {resultado.error ??
              `Borrados ${String(resultado.corporatesBorrados?.length ?? 0)} corporates de prueba (${
                resultado.corporatesBorrados === undefined ||
                resultado.corporatesBorrados.length === 0
                  ? 'ninguno'
                  : resultado.corporatesBorrados.join(', ')
              }) y ${String(resultado.usuariosBorrados ?? 0)} usuarios de prueba. ${
                resultado.sistemaVacio === true
                  ? 'El sistema vuelve a estar vacío: puedes repetir el kit desde T1.0.'
                  : 'Quedan corporates o personas reales, así que el sistema no está vacío.'
              }`}
          </span>
        </Aviso>
      )}
    </div>
  );
}
