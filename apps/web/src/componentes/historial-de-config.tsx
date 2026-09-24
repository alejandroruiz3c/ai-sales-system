'use client';

import { useState } from 'react';

import { revertirConfig } from '@/acciones/configuracion.ts';

import { Boton, Etiqueta, Tabla, Vacio } from './ui/index.tsx';

interface Version {
  version: number;
  config: unknown;
  nivel_autonomia: string;
  nota: string | null;
  revertida_de: number | null;
  creado_en: string;
  autor: string | null;
}

function cuando(valor: string): string {
  return new Date(valor).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistorialDeConfig({
  agente,
  versiones,
  puedeEditar,
}: {
  agente: string;
  versiones: readonly Version[];
  puedeEditar: boolean;
}) {
  const [abierta, setAbierta] = useState<number | null>(null);

  if (versiones.length === 0) {
    return (
      <Vacio titulo="Sin versiones todavía">
        Al guardar por primera vez aparecerá aquí la versión 1, y desde entonces cada cambio deja su
        rastro.
      </Vacio>
    );
  }

  const vigente = versiones[0]?.version;

  return (
    <div className="space-y-4">
      <Tabla cabeceras={['Versión', 'Cuándo', 'Quién', 'Nivel', 'Nota', '']}>
        {versiones.map((v) => (
          <tr key={v.version} data-testid={`version-${String(v.version)}`}>
            <td className="px-3 py-2.5">
              <Etiqueta tono={v.version === vigente ? 'ok' : 'neutro'}>
                v{v.version}
                {v.version === vigente ? ' · en vigor' : ''}
              </Etiqueta>
            </td>
            <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">{cuando(v.creado_en)}</td>
            <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">
              {v.autor ?? 'sistema'}
            </td>
            <td className="px-3 py-2.5">
              <Etiqueta tono={v.nivel_autonomia === 'L0' ? 'aviso' : 'acento'}>
                {v.nivel_autonomia}
              </Etiqueta>
            </td>
            <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">
              {v.revertida_de !== null ? (
                <span>revertida desde la v{v.revertida_de}</span>
              ) : (
                (v.nota ?? '—')
              )}
            </td>
            <td className="px-3 py-2.5 text-right">
              <div className="flex justify-end gap-1">
                <Boton
                  variante="discreto"
                  type="button"
                  className="px-2 text-xs"
                  onClick={() => {
                    setAbierta(abierta === v.version ? null : v.version);
                  }}
                >
                  {abierta === v.version ? 'Ocultar' : 'Ver'}
                </Boton>
                {puedeEditar && v.version !== vigente && (
                  <form action={revertirConfig}>
                    <input type="hidden" name="agente" value={agente} />
                    <input type="hidden" name="version" value={v.version} />
                    <Boton
                      variante="secundario"
                      type="submit"
                      className="px-2 py-1 text-xs"
                      data-testid={`revertir-${String(v.version)}`}
                    >
                      Revertir a esta
                    </Boton>
                  </form>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Tabla>

      {abierta !== null && (
        <pre
          data-testid="version-abierta"
          className="max-h-96 overflow-auto rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] p-4 font-mono text-xs text-[var(--color-muted)]"
        >
          {JSON.stringify(versiones.find((v) => v.version === abierta)?.config, null, 2)}
        </pre>
      )}
    </div>
  );
}
