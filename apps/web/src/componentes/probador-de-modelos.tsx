'use client';

import { useState } from 'react';

import {
  AreaDeTexto,
  Aviso,
  Boton,
  Campo,
  Entrada,
  Etiqueta,
  Seleccion,
  Tabla,
} from './ui/index.tsx';

interface Corporate {
  id: string;
  nombre: string;
  limiteEur: string;
  gastadoEur: string;
}

interface Uso {
  entrada: number;
  salida: number;
  cacheEscrita: number;
  cacheLeida: number;
}

interface Resultado {
  estado: 'valida' | 'texto' | 'fallida' | 'error' | 'bloqueada';
  modelo: string;
  nombreDelModelo: string;
  nivel: string;
  costeEur: number;
  uso: Uso;
  cacheAcertada: boolean;
  avisoDeCache?: string;
  intentos: number;
  trazaId: string;
  enlaceDeTraza?: string;
  plantilla?: string;
  datos?: unknown;
  texto?: string;
  errores?: string[];
  mensaje?: string;
}

const TAREAS = ['clasificar-respuesta', 'redactar-email', 'libre'] as const;
type Tarea = (typeof TAREAS)[number];

function esTarea(valor: string): valor is Tarea {
  return (TAREAS as readonly string[]).includes(valor);
}

interface Ejecucion {
  clave: string;
  tarea: Tarea;
  resumen: string;
  resultado: Resultado;
}

const PERFILES = [
  { id: 'clinica-aurora-demo', nombre: 'Clínica Aurora Demo (ficticio)' },
  { id: 'logistica-norte-demo', nombre: 'Logística Norte Demo (ficticio)' },
] as const;

const NIVELES = ['ligero', 'medio', 'alto'] as const;

const TONO_DE_ESTADO: Record<Resultado['estado'], 'ok' | 'aviso' | 'ko' | 'neutro'> = {
  valida: 'ok',
  texto: 'ok',
  fallida: 'aviso',
  error: 'ko',
  bloqueada: 'ko',
};

const TEXTO_DE_ESTADO: Record<Resultado['estado'], string> = {
  valida: 'Salida válida',
  texto: 'Texto',
  fallida: 'Salida inválida tras el reintento',
  error: 'Error del proveedor',
  bloqueada: 'Bloqueada por presupuesto',
};

function euros(valor: number): string {
  return `${valor.toLocaleString('es-ES', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} €`;
}

function textoDeCache(r: Resultado): string {
  if (r.cacheAcertada)
    return `Acierto · ${r.uso.cacheLeida.toLocaleString('es-ES')} tokens leídos de caché`;
  if (r.uso.cacheEscrita > 0) {
    return `Sin acierto · ${r.uso.cacheEscrita.toLocaleString('es-ES')} tokens escritos en caché (la próxima llamada con este perfil acertará)`;
  }
  return 'Sin acierto';
}

/**
 * El probador de modelos de `/lab` (F2): lo que el plan pide ver en cada
 * llamada —modelo elegido, coste y si hubo acierto de caché— más lo que hace
 * falta para el resto del kit: intentos (T2.5), traza (T2.6) y un historial
 * para comparar dos llamadas seguidas (T2.3).
 */
export function ProbadorDeModelos({ corporates }: { corporates: readonly Corporate[] }) {
  const [tenantId, setTenantId] = useState(corporates[0]?.id ?? '');
  const [tarea, setTarea] = useState<Tarea>('clasificar-respuesta');
  const [respuesta, setRespuesta] = useState('Ahora mismo no, escríbeme en enero');
  const [perfil, setPerfil] = useState<string>(PERFILES[0].id);
  const [cargo, setCargo] = useState('Director financiero');
  const [sector, setSector] = useState('Asesoría fiscal y laboral');
  const [empresa, setEmpresa] = useState('');
  const [nombre, setNombre] = useState('');
  const [contexto, setContexto] = useState('');
  const [nivel, setNivel] = useState<string>('ligero');
  const [prompt, setPrompt] = useState('');
  const [estropear, setEstropear] = useState(0);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<readonly Ejecucion[]>([]);

  const elegido = corporates.find((c) => c.id === tenantId);
  const ultima = historial[0];

  function cuerpo(): Record<string, unknown> {
    if (tarea === 'libre') return { modo: 'libre', tenantId, nivel, prompt };
    const entrada =
      tarea === 'clasificar-respuesta'
        ? { respuesta }
        : {
            prospecto: {
              cargo,
              ...(sector.trim() === '' ? {} : { sector }),
              ...(empresa.trim() === '' ? {} : { empresa }),
              ...(nombre.trim() === '' ? {} : { nombre }),
              ...(contexto.trim() === '' ? {} : { contexto }),
            },
          };
    return {
      modo: 'plantilla',
      tenantId,
      plantilla: tarea,
      ...(tarea === 'redactar-email' ? { perfil } : {}),
      entrada,
      estropear,
    };
  }

  function resumen(): string {
    if (tarea === 'clasificar-respuesta') return `«${respuesta.slice(0, 60)}»`;
    if (tarea === 'redactar-email') return `${cargo}${sector === '' ? '' : ` · ${sector}`}`;
    return prompt.slice(0, 60);
  }

  async function probar(): Promise<void> {
    setEnCurso(true);
    setError(null);
    try {
      const respuestaHttp = await fetch('/api/lab/probador', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo()),
      });
      const json = (await respuestaHttp.json()) as Resultado & { error?: string };
      if (!respuestaHttp.ok || json.error !== undefined) {
        setError(json.error ?? `Error ${String(respuestaHttp.status)}`);
        return;
      }
      setHistorial((previo) =>
        [{ clave: json.trazaId, tarea, resumen: resumen(), resultado: json }, ...previo].slice(
          0,
          12,
        ),
      );
    } catch {
      setError('No se ha podido contactar con el servidor.');
    } finally {
      setEnCurso(false);
    }
  }

  if (corporates.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No hay corporates de prueba. Crea uno desde el panel (con la casilla «es un corporate de
        prueba») y asígnale presupuesto: las llamadas se cobran en él.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Campo
          etiqueta="Corporate de prueba"
          ayuda={
            elegido ? `Presupuesto: ${elegido.gastadoEur} € de ${elegido.limiteEur} €` : undefined
          }
        >
          <Seleccion
            data-testid="probador-corporate"
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
        <Campo etiqueta="Tarea">
          <Seleccion
            data-testid="probador-tarea"
            value={tarea}
            onChange={(e) => {
              if (esTarea(e.target.value)) setTarea(e.target.value);
            }}
          >
            <option value="clasificar-respuesta">Clasificar respuesta (plantilla)</option>
            <option value="redactar-email">Redactar email (plantilla)</option>
            <option value="libre">Prompt libre</option>
          </Seleccion>
        </Campo>
        {tarea === 'libre' ? (
          <Campo
            etiqueta="Nivel de la tarea"
            ayuda="El router elige el modelo más barato capaz del nivel."
          >
            <Seleccion
              data-testid="probador-nivel"
              value={nivel}
              onChange={(e) => {
                setNivel(e.target.value);
              }}
            >
              {NIVELES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Seleccion>
          </Campo>
        ) : (
          <Campo
            etiqueta="Forzar salida malformada (T2.5)"
            ayuda="Estropea a propósito las primeras respuestas del modelo. Se cobran igual."
          >
            <Seleccion
              data-testid="probador-estropear"
              value={String(estropear)}
              onChange={(e) => {
                setEstropear(Number(e.target.value));
              }}
            >
              <option value="0">No</option>
              <option value="1">La primera respuesta (el reintento la corrige)</option>
              <option value="2">Las dos (se marca como inválida)</option>
            </Seleccion>
          </Campo>
        )}
      </div>

      {tarea === 'clasificar-respuesta' && (
        <Campo etiqueta="Respuesta del prospecto">
          <AreaDeTexto
            data-testid="probador-respuesta"
            rows={2}
            value={respuesta}
            onChange={(e) => {
              setRespuesta(e.target.value);
            }}
          />
        </Campo>
      )}

      {tarea === 'redactar-email' && (
        <div className="grid gap-4 md:grid-cols-3">
          <Campo
            etiqueta="Perfil comercial"
            ayuda="De momento, uno de los dos ficticios del kit. El real llega con el onboarding (F3)."
          >
            <Seleccion
              data-testid="probador-perfil"
              value={perfil}
              onChange={(e) => {
                setPerfil(e.target.value);
              }}
            >
              {PERFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Cargo del prospecto">
            <Entrada
              data-testid="probador-cargo"
              value={cargo}
              onChange={(e) => {
                setCargo(e.target.value);
              }}
            />
          </Campo>
          <Campo etiqueta="Sector">
            <Entrada
              data-testid="probador-sector"
              value={sector}
              onChange={(e) => {
                setSector(e.target.value);
              }}
            />
          </Campo>
          <Campo etiqueta="Nombre (opcional)">
            <Entrada
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
              }}
            />
          </Campo>
          <Campo etiqueta="Empresa (opcional)">
            <Entrada
              value={empresa}
              onChange={(e) => {
                setEmpresa(e.target.value);
              }}
            />
          </Campo>
          <Campo etiqueta="Contexto (opcional)" ayuda="Se trata como dato, nunca como instrucción.">
            <Entrada
              value={contexto}
              onChange={(e) => {
                setContexto(e.target.value);
              }}
            />
          </Campo>
        </div>
      )}

      {tarea === 'libre' && (
        <Campo etiqueta="Prompt">
          <AreaDeTexto
            data-testid="probador-prompt"
            rows={4}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
          />
        </Campo>
      )}

      <div className="flex items-center gap-3">
        <Boton
          data-testid="probador-enviar"
          disabled={enCurso || tenantId === ''}
          onClick={() => void probar()}
        >
          {enCurso ? 'Llamando al modelo…' : 'Probar'}
        </Boton>
        <span className="text-xs text-[var(--color-muted)]">
          Cada prueba es una llamada real y se cobra en el presupuesto del corporate.
        </span>
      </div>

      {error !== null && (
        <Aviso tono="ko" titulo="No se ha podido probar">
          {error}
        </Aviso>
      )}

      {ultima !== undefined && <DetalleDeEjecucion ejecucion={ultima} />}

      {historial.length > 1 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-white">Últimas pruebas</h3>
          <Tabla cabeceras={['Tarea', 'Entrada', 'Modelo', 'Coste', 'Caché', 'Intentos', 'Estado']}>
            {historial.map((e) => (
              <tr key={e.clave} data-testid="probador-historial-fila">
                <td className="px-3 py-2">{e.tarea}</td>
                <td className="px-3 py-2 text-[var(--color-muted)]">{e.resumen}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.resultado.nombreDelModelo}</td>
                <td className="px-3 py-2 font-mono text-xs">{euros(e.resultado.costeEur)}</td>
                <td className="px-3 py-2">{e.resultado.cacheAcertada ? 'acierto' : '—'}</td>
                <td className="px-3 py-2">{e.resultado.intentos}</td>
                <td className="px-3 py-2">
                  <Etiqueta tono={TONO_DE_ESTADO[e.resultado.estado]}>
                    {e.resultado.estado}
                  </Etiqueta>
                </td>
              </tr>
            ))}
          </Tabla>
        </div>
      )}
    </div>
  );
}

function DetalleDeEjecucion({ ejecucion }: { ejecucion: Ejecucion }) {
  const r = ejecucion.resultado;
  return (
    <div
      data-testid="probador-resultado"
      className="space-y-4 rounded-md border border-[var(--color-line)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Etiqueta
          tono={TONO_DE_ESTADO[r.estado]}
          data-testid="probador-estado"
          data-estado={r.estado}
        >
          {TEXTO_DE_ESTADO[r.estado]}
        </Etiqueta>
        {r.plantilla !== undefined && <Etiqueta>{r.plantilla}</Etiqueta>}
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--color-muted)]">Modelo elegido</dt>
          <dd data-testid="probador-modelo" data-modelo={r.modelo} className="text-white">
            {r.nombreDelModelo}{' '}
            <span className="text-xs text-[var(--color-muted)]">· nivel {r.nivel}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted)]">Coste</dt>
          <dd data-testid="probador-coste" data-coste={r.costeEur} className="font-mono text-white">
            {euros(r.costeEur)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted)]">Caché</dt>
          <dd
            data-testid="probador-cache"
            data-acierto={String(r.cacheAcertada)}
            className="text-white"
          >
            {textoDeCache(r)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted)]">Intentos</dt>
          <dd data-testid="probador-intentos" className="text-white">
            {r.intentos} {r.intentos > 1 ? '(hubo reintento)' : ''}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-[var(--color-muted)]">
        Tokens: {r.uso.entrada} de entrada · {r.uso.salida} de salida · {r.uso.cacheLeida} leídos de
        caché · {r.uso.cacheEscrita} escritos en caché. Traza{' '}
        {r.enlaceDeTraza === undefined ? (
          <span className="font-mono">{r.trazaId}</span>
        ) : (
          <a
            className="font-mono underline"
            href={r.enlaceDeTraza}
            target="_blank"
            rel="noreferrer"
          >
            {r.trazaId}
          </a>
        )}
        .
      </p>

      {r.avisoDeCache !== undefined && <Aviso tono="neutro">{r.avisoDeCache}</Aviso>}
      {r.mensaje !== undefined && (
        <Aviso tono="ko" titulo={TEXTO_DE_ESTADO[r.estado]}>
          {r.mensaje}
        </Aviso>
      )}
      {r.errores !== undefined && (
        <Aviso tono="aviso" titulo="La salida no cumple el esquema, ni en el reintento">
          <ul className="list-disc pl-5">
            {r.errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <div>
        <h4 className="mb-1 text-xs text-[var(--color-muted)]">Salida</h4>
        <pre
          data-testid="probador-salida"
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-ink)] p-3 text-xs text-white"
        >
          {r.datos !== undefined ? JSON.stringify(r.datos, null, 2) : (r.texto ?? '—')}
        </pre>
      </div>
    </div>
  );
}
