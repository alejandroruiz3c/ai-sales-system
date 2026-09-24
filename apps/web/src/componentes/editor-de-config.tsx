'use client';

import { useActionState, useState } from 'react';

import type { ConfigDeAgente } from '@sales-os/db';

import {
  guardarConfig,
  guardarConfigJson,
  type ResultadoDeConfig,
} from '@/acciones/configuracion.ts';

import { Aviso, AreaDeTexto, Boton, Campo, Entrada, Seleccion } from './ui/index.tsx';

const INICIAL: ResultadoDeConfig = {};

const NIVELES = [
  { valor: 'L0', texto: 'L0 · propone y no envía nunca' },
  { valor: 'L1', texto: 'L1 · envía solo con aprobación humana' },
  { valor: 'L2', texto: 'L2 · envía dentro de sus límites' },
  { valor: 'L3', texto: 'L3 · autónomo' },
] as const;

const DIAS = [
  { valor: 1, texto: 'L' },
  { valor: 2, texto: 'M' },
  { valor: 3, texto: 'X' },
  { valor: 4, texto: 'J' },
  { valor: 5, texto: 'V' },
  { valor: 6, texto: 'S' },
  { valor: 7, texto: 'D' },
] as const;

/** El error de un campo concreto, para pintarlo donde toca. */
function errorDe(estado: ResultadoDeConfig, campo: string): string | undefined {
  return estado.errores?.find((e) => e.campo === campo)?.mensaje;
}

export function EditorDeConfig({
  agente,
  config,
  version,
  puedeEditar,
}: {
  agente: string;
  config: ConfigDeAgente;
  version: number;
  puedeEditar: boolean;
}) {
  const [vista, setVista] = useState<'formulario' | 'json'>('formulario');
  const [estado, accion, enCurso] = useActionState(guardarConfig, INICIAL);
  const [estadoJson, accionJson, enCursoJson] = useActionState(guardarConfigJson, INICIAL);

  const actual = vista === 'formulario' ? estado : estadoJson;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Boton
          variante={vista === 'formulario' ? 'principal' : 'secundario'}
          type="button"
          onClick={() => {
            setVista('formulario');
          }}
          className="px-3 py-1.5 text-xs"
          data-testid="vista-formulario"
        >
          Formulario
        </Boton>
        <Boton
          variante={vista === 'json' ? 'principal' : 'secundario'}
          type="button"
          onClick={() => {
            setVista('json');
          }}
          className="px-3 py-1.5 text-xs"
          data-testid="vista-json"
        >
          JSON avanzado
        </Boton>
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          {version === 0 ? 'sin guardar todavía' : `versión ${String(version)} en vigor`}
        </span>
      </div>

      {vista === 'formulario' ? (
        <form action={accion} className="space-y-5" data-testid="config-formulario">
          <input type="hidden" name="agente" value={agente} />

          <Campo
            etiqueta="Objetivo"
            ayuda="Qué tiene que conseguir, en una frase. Sin nombres de productos ni precios: eso lo pone el perfil comercial."
            error={errorDe(actual, 'objetivo')}
          >
            <AreaDeTexto
              name="objetivo"
              rows={2}
              defaultValue={config.objetivo}
              disabled={!puedeEditar}
              data-testid="config-objetivo"
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Tono" error={errorDe(actual, 'tono')}>
              <Seleccion
                name="tono"
                defaultValue={config.tono}
                disabled={!puedeEditar}
                data-testid="config-tono"
              >
                <option value="neutro">Neutro</option>
                <option value="cercano">Cercano</option>
                <option value="formal">Formal</option>
                <option value="directo">Directo</option>
              </Seleccion>
            </Campo>

            <Campo etiqueta="Idioma" error={errorDe(actual, 'idioma')}>
              <Seleccion name="idioma" defaultValue={config.idioma} disabled={!puedeEditar}>
                <option value="es">Castellano</option>
                <option value="en">Inglés</option>
              </Seleccion>
            </Campo>

            <Campo
              etiqueta="Nivel de autonomía"
              ayuda="Lo lee el agente, no la interfaz."
              error={errorDe(actual, 'nivelAutonomia')}
            >
              <Seleccion
                name="nivelAutonomia"
                defaultValue={config.nivelAutonomia}
                disabled={!puedeEditar}
                data-testid="config-nivel"
              >
                {NIVELES.map((n) => (
                  <option key={n.valor} value={n.valor}>
                    {n.texto}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <fieldset className="rounded-md border border-[var(--color-line)] px-4 py-3">
            <legend className="px-1 text-sm font-medium text-white">Ventana horaria</legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-[140px_140px_1fr]">
              <Campo etiqueta="Desde" error={errorDe(actual, 'ventanaHoraria.desde')}>
                <Entrada
                  name="desde"
                  type="time"
                  defaultValue={config.ventanaHoraria.desde}
                  disabled={!puedeEditar}
                  data-testid="config-desde"
                />
              </Campo>
              <Campo etiqueta="Hasta" error={errorDe(actual, 'ventanaHoraria.hasta')}>
                <Entrada
                  name="hasta"
                  type="time"
                  defaultValue={config.ventanaHoraria.hasta}
                  disabled={!puedeEditar}
                  data-testid="config-hasta"
                />
              </Campo>
              <Campo etiqueta="Días" error={errorDe(actual, 'ventanaHoraria.dias')}>
                <div className="flex gap-1.5">
                  {DIAS.map((d) => (
                    <label
                      key={d.valor}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[var(--color-line)] text-xs has-checked:border-[var(--color-accent)] has-checked:text-white"
                    >
                      <input
                        type="checkbox"
                        name="dias"
                        value={d.valor}
                        defaultChecked={config.ventanaHoraria.dias.includes(d.valor)}
                        disabled={!puedeEditar}
                        className="sr-only"
                      />
                      {d.texto}
                    </label>
                  ))}
                </div>
              </Campo>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Límite diario"
              ayuda="0 desactiva el canal."
              error={errorDe(actual, 'limites.porDia')}
            >
              <Entrada
                name="porDia"
                type="number"
                defaultValue={config.limites.porDia}
                disabled={!puedeEditar}
                data-testid="config-por-dia"
              />
            </Campo>
            <Campo etiqueta="Límite semanal" error={errorDe(actual, 'limites.porSemana')}>
              <Entrada
                name="porSemana"
                type="number"
                defaultValue={config.limites.porSemana}
                disabled={!puedeEditar}
                data-testid="config-por-semana"
              />
            </Campo>
          </div>

          <Campo etiqueta="Nota del cambio (opcional)" ayuda="Aparece en el historial.">
            <Entrada
              name="nota"
              maxLength={200}
              disabled={!puedeEditar}
              data-testid="config-nota"
            />
          </Campo>

          <Mensajes estado={estado} />

          {puedeEditar && (
            <Boton type="submit" disabled={enCurso} data-testid="config-guardar">
              {enCurso ? 'Guardando…' : 'Guardar versión nueva'}
            </Boton>
          )}
        </form>
      ) : (
        <form action={accionJson} className="space-y-4" data-testid="config-json">
          <input type="hidden" name="agente" value={agente} />
          <Campo
            etiqueta="Configuración completa"
            ayuda="Lo mismo que el formulario, sin intermediarios. Se valida con el mismo esquema."
          >
            <AreaDeTexto
              name="json"
              rows={20}
              defaultValue={JSON.stringify(config, null, 2)}
              disabled={!puedeEditar}
              data-testid="config-json-texto"
              spellCheck={false}
            />
          </Campo>
          <Campo etiqueta="Nota del cambio (opcional)">
            <Entrada name="nota" maxLength={200} disabled={!puedeEditar} />
          </Campo>

          <Mensajes estado={estadoJson} />

          {puedeEditar && (
            <Boton type="submit" disabled={enCursoJson} data-testid="config-json-guardar">
              {enCursoJson ? 'Guardando…' : 'Guardar versión nueva'}
            </Boton>
          )}
        </form>
      )}
    </div>
  );
}

function Mensajes({ estado }: { estado: ResultadoDeConfig }) {
  return (
    <>
      {estado.error !== undefined && (
        <Aviso tono="ko" titulo={estado.error}>
          {estado.errores === undefined || estado.errores.length === 0 ? (
            <span data-testid="config-error">Revisa los campos marcados.</span>
          ) : (
            <ul className="space-y-1" data-testid="config-error">
              {estado.errores.map((e) => (
                <li key={`${e.campo}-${e.mensaje}`}>
                  <code className="font-mono text-xs text-white">{e.campo}</code> · {e.mensaje}
                </li>
              ))}
            </ul>
          )}
        </Aviso>
      )}
      {estado.ok !== undefined && (
        <Aviso tono="ok">
          <span data-testid="config-ok">{estado.ok}</span>
        </Aviso>
      )}
    </>
  );
}
