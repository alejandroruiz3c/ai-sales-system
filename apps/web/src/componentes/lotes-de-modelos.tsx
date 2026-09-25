'use client';

import { useCallback, useEffect, useState } from 'react';

import { Aviso, Boton, Campo, Etiqueta, Seleccion, Tabla } from './ui/index.tsx';

interface Corporate {
  id: string;
  nombre: string;
}

interface ElementoCorregido {
  id: string;
  texto: string;
  esperada: string;
  obtenida: string | null;
  recontactoEsperado: string;
  recontactoObtenido: string | null;
  acierto: boolean;
  reintentado: boolean;
}

interface Lote {
  loteId: string;
  tenant: string;
  enviadoEn: string;
  modelo: string;
  terminado: boolean;
  resultado?: {
    aciertos: number;
    total: number;
    coste_eur: number;
    coste_del_lote_eur: number;
    coste_de_reintentos_eur: number;
    coste_sin_lote_eur: number;
    coste_por_elemento_eur: number;
    enlaceDeTraza?: string;
    traza_id: string;
    resultados: ElementoCorregido[];
  };
}

const euros = (v: number, decimales = 6): string =>
  `${v.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} €`;

/** Cada cuánto se vuelve a mirar mientras haya un lote sin terminar. */
const REFRESCO_MS = 15_000;

/**
 * Caso T2.4: el lote de 20 clasificaciones por la Batch API.
 *
 * El lote tarda de uno a varios minutos (hasta 24 horas en el peor caso), así
 * que la tarjeta no espera: lanza, y enseña los lotes con su estado. Mientras
 * haya uno sin terminar se refresca sola. Cuando vuelve, enseña la corrección
 * caso por caso contra el fichero y el coste comparado con el mismo uso fuera
 * de lote, que es lo que el kit pide comprobar: «aproximadamente la mitad».
 */
export function LotesDeModelos({ corporates }: { corporates: readonly Corporate[] }) {
  const [tenantId, setTenantId] = useState(corporates[0]?.id ?? '');
  const [lotes, setLotes] = useState<readonly Lote[]>([]);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'ko'; texto: string } | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    const respuesta = await fetch('/api/lab/lotes', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const json = (await respuesta.json()) as { lotes?: Lote[] };
    setLotes(json.lotes ?? []);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const hayPendientes = lotes.some((l) => !l.terminado);
  useEffect(() => {
    if (!hayPendientes) return;
    const temporizador = setInterval(() => void cargar(), REFRESCO_MS);
    return () => {
      clearInterval(temporizador);
    };
  }, [hayPendientes, cargar]);

  async function lanzar(): Promise<void> {
    setEnCurso(true);
    setMensaje(null);
    try {
      const respuesta = await fetch('/api/lab/lote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const json = (await respuesta.json()) as {
        error?: string;
        estado?: string;
        loteId?: string;
        mensaje?: string;
        costeMaximoEur?: number;
      };
      if (json.error !== undefined) setMensaje({ tono: 'ko', texto: json.error });
      else if (json.estado === 'bloqueada')
        setMensaje({ tono: 'ko', texto: json.mensaje ?? 'Bloqueado por presupuesto.' });
      else {
        setMensaje({
          tono: 'ok',
          texto: `Lote ${json.loteId ?? ''} enviado. Reservados como máximo ${euros(json.costeMaximoEur ?? 0, 4)}; se cobrará lo real al terminar.`,
        });
      }
      await cargar();
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <Campo etiqueta="Corporate de prueba">
            <Seleccion
              data-testid="lote-corporate"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
              }}
            >
              {corporates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
        </div>
        <Boton
          data-testid="lote-lanzar"
          disabled={enCurso || tenantId === ''}
          onClick={() => void lanzar()}
        >
          {enCurso ? 'Enviando…' : 'Lanzar lote de 20 respuestas (T2.4)'}
        </Boton>
        <a className="text-sm text-[var(--color-muted)] underline" href="/api/lab/respuestas-t24">
          Descargar el CSV de las 20 respuestas
        </a>
        <Boton variante="discreto" onClick={() => void cargar()}>
          Actualizar
        </Boton>
      </div>

      {mensaje !== null && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}

      {lotes.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Todavía no hay lotes.</p>
      ) : (
        lotes.map((lote) => <TarjetaDeLote key={lote.loteId} lote={lote} />)
      )}
    </div>
  );
}

function TarjetaDeLote({ lote }: { lote: Lote }) {
  const r = lote.resultado;
  return (
    <div
      data-testid="lote"
      data-terminado={String(lote.terminado)}
      className="space-y-3 rounded-md border border-[var(--color-line)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Etiqueta tono={lote.terminado ? 'ok' : 'aviso'}>
          {lote.terminado ? 'Terminado' : 'En proceso'}
        </Etiqueta>
        <span className="font-mono text-xs">{lote.loteId}</span>
        <span className="text-[var(--color-muted)]">
          · {lote.tenant} · {lote.modelo} · enviado{' '}
          {new Date(lote.enviadoEn).toLocaleString('es-ES')}
        </span>
      </div>

      {r !== undefined && (
        <>
          <dl className="grid gap-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-[var(--color-muted)]">Aciertos</dt>
              <dd data-testid="lote-aciertos" data-aciertos={r.aciertos} className="text-white">
                {r.aciertos} de {r.total}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">Coste por unidad en lote</dt>
              <dd className="font-mono text-white">{euros(r.coste_por_elemento_eur)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">El mismo uso fuera de lote</dt>
              <dd className="font-mono text-white">
                {euros(r.coste_sin_lote_eur / Math.max(1, r.total))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-muted)]">Coste total</dt>
              <dd className="font-mono text-white">
                {euros(r.coste_eur)}
                {r.coste_de_reintentos_eur > 0 && (
                  <span className="block text-xs text-[var(--color-muted)]">
                    incluye {euros(r.coste_de_reintentos_eur)} de reintentos
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--color-muted)]">
            Traza{' '}
            {r.enlaceDeTraza === undefined ? (
              <span className="font-mono">{r.traza_id}</span>
            ) : (
              <a
                className="font-mono underline"
                href={r.enlaceDeTraza}
                target="_blank"
                rel="noreferrer"
              >
                {r.traza_id}
              </a>
            )}
          </p>
          <Tabla cabeceras={['', 'Respuesta', 'Esperada', 'Obtenida', 'Recontacto']}>
            {r.resultados.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2">{e.acierto ? '✔' : '✖'}</td>
                <td className="px-3 py-2 text-[var(--color-muted)]">{e.texto}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.esperada}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {e.obtenida ?? '—'}
                  {e.reintentado ? ' (reintento)' : ''}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {e.recontactoEsperado === ''
                    ? '—'
                    : `${e.recontactoEsperado} → ${e.recontactoObtenido ?? 'null'}`}
                </td>
              </tr>
            ))}
          </Tabla>
        </>
      )}
    </div>
  );
}
