'use client';

import { useState } from 'react';

import { NIVELES } from '@sales-os/agent-prueba';

import { Aviso, Boton, Campo, Entrada, Etiqueta, Seleccion, Tabla } from './ui/index.tsx';

interface Corporate {
  id: string;
  nombre: string;
  nivelAutonomia: string;
  limiteEur: string;
  gastadoEur: string;
  cortado: boolean;
  pendientes: number;
}

interface Cobro {
  permitida: boolean;
  motivo: string;
  mensaje?: string;
  limite_eur: string | number;
  gastado_eur: string | number;
  porcentaje?: string | number | null;
  umbrales_cruzados?: string[];
}

interface Linea {
  clave: string;
  texto: string;
  tono: 'ok' | 'aviso' | 'ko' | 'neutro';
}

const euros = (v: string | number | undefined): string =>
  v === undefined ? '—' : `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €`;

function tonoDeCobro(cobro: Cobro): 'ok' | 'aviso' | 'ko' {
  if (!cobro.permitida) return 'ko';
  return (cobro.umbrales_cruzados ?? []).length > 0 ? 'aviso' : 'ok';
}

function textoDeCobro(cobro: Cobro, n: number): string {
  if (!cobro.permitida) {
    return `Llamada ${String(n)} · BLOQUEADA (${cobro.motivo}) · ${cobro.mensaje ?? ''}`;
  }
  const umbrales = cobro.umbrales_cruzados ?? [];
  const cruce = umbrales.length > 0 ? ` · cruza el ${umbrales.join(' % y el ')} %` : '';
  return `Llamada ${String(n)} · cobrada · ${euros(cobro.gastado_eur)} de ${euros(cobro.limite_eur)}${cruce}`;
}

/**
 * El probador del agente ficticio: casos T1.7, T1.8 y T1.9 en una tarjeta.
 *
 * Están juntos porque los tres se prueban sobre el mismo agente y se explican
 * unos con otros: bajas el nivel a L0 y el mismo botón deja de crear
 * aprobaciones; pulsas la llamada de prueba diez veces y el presupuesto corta;
 * después el agente rebota por presupuesto y no por nivel. Separarlos en tres
 * pantallas obligaría a ir y volver para entender qué está pasando.
 */
export function ProbadorDeAgente({ corporates }: { corporates: readonly Corporate[] }) {
  const [tenantId, setTenantId] = useState(corporates[0]?.id ?? '');
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState<readonly Linea[]>([]);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const [contador, setContador] = useState(0);

  const elegido = corporates.find((c) => c.id === tenantId);

  function anotar(texto: string, tono: Linea['tono']): void {
    setLineas((previas) =>
      [{ clave: `${String(Date.now())}-${String(Math.random())}`, texto, tono }, ...previas].slice(
        0,
        40,
      ),
    );
  }

  async function llamar(ruta: string, cuerpo: Record<string, unknown>): Promise<unknown> {
    const respuesta = await fetch(`/api/lab/${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, ...cuerpo }),
    });
    return respuesta.json();
  }

  async function llamadaLlm(veces: number): Promise<void> {
    setEnCurso('llm');
    let n = contador;
    for (let i = 0; i < veces; i += 1) {
      n += 1;
      const resultado = (await llamar('llamada-de-prueba', {})) as Cobro & { error?: string };
      if (resultado.error !== undefined) {
        anotar(`Llamada ${String(n)} · error: ${resultado.error}`, 'ko');
        break;
      }
      anotar(textoDeCobro(resultado, n), tonoDeCobro(resultado));
    }
    setContador(n);
    setEnCurso(null);
  }

  async function ejecutarAgente(): Promise<void> {
    setEnCurso('agente');
    const r = (await llamar('agente-de-prueba', { nota })) as {
      error?: string;
      nivel?: string;
      destino?: string;
      motivo?: string;
      aprobacionId?: string;
      eventoEmitido?: string;
      cobro?: Cobro;
    };
    if (r.error !== undefined) {
      anotar(`Agente · error: ${r.error}`, 'ko');
    } else if (r.cobro !== undefined && !r.cobro.permitida) {
      anotar(`Agente · no ha podido ejecutarse: ${r.cobro.mensaje ?? r.cobro.motivo}`, 'ko');
    } else {
      const extra =
        r.aprobacionId !== undefined
          ? ' · aprobación creada en la cola'
          : r.eventoEmitido !== undefined
            ? ` · evento ${r.eventoEmitido} emitido`
            : ' · nada enviado';
      anotar(
        `Agente en ${r.nivel ?? '?'} · ${r.destino ?? '?'}${extra} · ${r.motivo ?? ''}`,
        r.destino === 'enviar' ? 'aviso' : 'ok',
      );
    }
    setEnCurso(null);
  }

  async function cambiarNivel(nivel: string): Promise<void> {
    setEnCurso('nivel');
    const r = (await llamar('nivel-de-prueba', { nivel })) as {
      error?: string;
      nivel?: string;
      version?: number;
    };
    if (r.error !== undefined) anotar(`Nivel · error: ${r.error}`, 'ko');
    else anotar(`Nivel cambiado a ${r.nivel ?? nivel} · versión ${String(r.version ?? 0)}`, 'ok');
    setEnCurso(null);
  }

  if (corporates.length === 0) {
    return (
      <Aviso tono="aviso" titulo="No hay corporates de prueba">
        La sala de pruebas solo actúa sobre corporates marcados como de prueba. Crea uno desde el
        panel dejando marcada la casilla «Es un corporate de prueba».
      </Aviso>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <Campo etiqueta="Corporate de prueba" ayuda="Solo aparecen los marcados como de prueba.">
          <Seleccion
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
            }}
            data-testid="lab-corporate"
          >
            {corporates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Nota (opcional)" ayuda="Para reconocer tu propia prueba en la cola.">
          <Entrada
            value={nota}
            onChange={(e) => {
              setNota(e.target.value);
            }}
            data-testid="lab-nota"
          />
        </Campo>
      </div>

      {elegido !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <Etiqueta tono={elegido.nivelAutonomia === 'L0' ? 'aviso' : 'acento'}>
            nivel {elegido.nivelAutonomia}
          </Etiqueta>
          <Etiqueta tono={elegido.cortado ? 'ko' : 'ok'}>
            {euros(elegido.gastadoEur)} de {euros(elegido.limiteEur)}
          </Etiqueta>
          <Etiqueta>{String(elegido.pendientes)} pendientes</Etiqueta>
          <span>· los valores se actualizan al recargar la página</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Boton
          type="button"
          onClick={() => void ejecutarAgente()}
          disabled={enCurso !== null}
          data-testid="lab-ejecutar-agente"
        >
          {enCurso === 'agente' ? 'Ejecutando…' : 'Ejecutar el agente de prueba'}
        </Boton>
        <Boton
          variante="secundario"
          type="button"
          onClick={() => void llamadaLlm(1)}
          disabled={enCurso !== null}
          data-testid="lab-llamada-llm"
        >
          Llamada LLM de prueba
        </Boton>
        <Boton
          variante="secundario"
          type="button"
          onClick={() => void llamadaLlm(20)}
          disabled={enCurso !== null}
          data-testid="lab-llamada-llm-20"
        >
          {enCurso === 'llm' ? 'Cobrando…' : '20 llamadas seguidas'}
        </Boton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-muted)]">Nivel de autonomía:</span>
        {NIVELES.map((n) => (
          <Boton
            key={n}
            variante={elegido?.nivelAutonomia === n ? 'principal' : 'secundario'}
            type="button"
            onClick={() => void cambiarNivel(n)}
            disabled={enCurso !== null}
            className="px-2.5 py-1 text-xs"
            data-testid={`lab-nivel-${n}`}
          >
            {n}
          </Boton>
        ))}
      </div>

      {lineas.length > 0 && (
        <Tabla cabeceras={['Resultado']}>
          {lineas.map((l) => (
            <tr key={l.clave}>
              <td className="px-3 py-2 text-xs">
                <span
                  className={
                    l.tono === 'ko'
                      ? 'text-[var(--color-ko)]'
                      : l.tono === 'aviso'
                        ? 'text-[var(--color-warn)]'
                        : 'text-[var(--color-muted)]'
                  }
                  data-testid="lab-resultado"
                >
                  {l.texto}
                </span>
              </td>
            </tr>
          ))}
        </Tabla>
      )}
    </div>
  );
}
