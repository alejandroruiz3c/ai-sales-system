import { redirect } from 'next/navigation';

import { borrarArchivo, enlaceDeDescarga } from '@/acciones/archivos.ts';
import { FormularioDeSubida } from '@/componentes/formulario-de-subida.tsx';
import { Aviso, Boton, Etiqueta, Tabla, Tarjeta, Vacio } from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { puedeAdministrar, puedeEditar, sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

const CARPETAS = [
  {
    clave: 'context',
    titulo: 'Contexto',
    descripcion:
      'Lo que define al corporate: deck, argumentario, notas. Lo lee el onboarding (F3).',
  },
  {
    clave: 'inputs',
    titulo: 'Entradas',
    descripcion: 'Lo que entra para procesar: listas de prospectos, ficheros de una campaña.',
  },
  {
    clave: 'outputs',
    titulo: 'Salidas',
    descripcion: 'Lo que el sistema genera y merece conservarse.',
  },
] as const;

interface FilaDeArchivo {
  id: string;
  carpeta: string;
  nombre: string;
  descripcion: string | null;
  version_actual: number;
  actualizado_en: string;
}

interface FilaDeVersion {
  id: string;
  file_id: string;
  version: number;
  tamano_bytes: string;
  mime: string;
  sha256: string;
  creado_en: string;
  autor: string | null;
}

function peso(bytes: string): string {
  const n = Number(bytes);
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function cuando(valor: string): string {
  return new Date(valor).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function PaginaDeArchivos({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');
  const { error } = await searchParams;

  const tenantId = sesion.tenant.id;
  const edita = puedeEditar(sesion.tenant.rol);
  const administra = puedeAdministrar(sesion.tenant.rol);

  const { archivos, versiones } = await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => ({
    archivos: await ctx.consultar<FilaDeArchivo>(
      `select id, carpeta, nombre, descripcion, version_actual, actualizado_en::text as actualizado_en
       from public.tenant_files
       where tenant_id = $1 and borrado_en is null
       order by carpeta, lower(nombre)`,
      [tenantId],
    ),
    versiones: await ctx.consultar<FilaDeVersion>(
      `select v.id, v.file_id, v.version, v.tamano_bytes::text as tamano_bytes, v.mime,
              v.sha256, v.creado_en::text as creado_en, p.nombre as autor
       from public.tenant_file_versions v
       left join public.perfiles p on p.id = v.subido_por
       where v.tenant_id = $1
       order by v.file_id, v.version desc`,
      [tenantId],
    ),
  }));

  const porArchivo = new Map<string, FilaDeVersion[]>();
  for (const v of versiones) {
    porArchivo.set(v.file_id, [...(porArchivo.get(v.file_id) ?? []), v]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Archivos</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Los de {sesion.tenant.nombre}, y solo los de {sesion.tenant.nombre}. Reemplazar un archivo
          no borra nada: crea la versión siguiente y la anterior sigue descargable.
        </p>
      </div>

      {error === 'no-encontrado' && (
        <Aviso tono="ko" titulo="No se ha podido descargar">
          <span data-testid="archivo-denegado">
            Ese archivo no existe o no pertenece a este corporate.
          </span>
        </Aviso>
      )}

      {!edita && (
        <Aviso tono="neutro" titulo="Estás como lector">
          Ves los archivos y los puedes descargar. Subir o reemplazar exige ser editor, y eso lo
          decide la política de la tabla, no esta pantalla.
        </Aviso>
      )}

      {edita && (
        <Tarjeta
          titulo="Subir un archivo"
          descripcion="Si ya existe uno con el mismo nombre en la misma carpeta, se guarda como versión nueva."
        >
          <FormularioDeSubida />
        </Tarjeta>
      )}

      {CARPETAS.map((carpeta) => {
        const deLaCarpeta = archivos.filter((a) => a.carpeta === carpeta.clave);
        return (
          <Tarjeta
            key={carpeta.clave}
            titulo={`${carpeta.titulo} · ${carpeta.clave}/`}
            descripcion={carpeta.descripcion}
          >
            {deLaCarpeta.length === 0 ? (
              <Vacio titulo="Sin archivos todavía">
                Nada en <code className="font-mono">{carpeta.clave}/</code> de este corporate.
              </Vacio>
            ) : (
              <div className="space-y-4">
                {deLaCarpeta.map((a) => {
                  const suyas = porArchivo.get(a.id) ?? [];
                  return (
                    <details
                      key={a.id}
                      className="rounded-md border border-[var(--color-line)]"
                      data-testid={`archivo-${a.nombre}`}
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                        <span className="font-mono text-sm text-white">{a.nombre}</span>
                        <Etiqueta tono={a.version_actual > 1 ? 'acento' : 'neutro'}>
                          {a.version_actual > 1
                            ? `${String(a.version_actual)} versiones`
                            : 'versión 1'}
                        </Etiqueta>
                        <span className="text-xs text-[var(--color-muted)]">
                          {cuando(a.actualizado_en)}
                        </span>
                        {a.descripcion !== null && (
                          <span className="text-xs text-[var(--color-muted)]">
                            · {a.descripcion}
                          </span>
                        )}
                      </summary>

                      <div className="border-t border-[var(--color-line)] px-4 py-3">
                        <Tabla cabeceras={['Versión', 'Subida', 'Quién', 'Peso', 'sha256', '']}>
                          {suyas.map((v) => (
                            <tr key={v.id}>
                              <td className="px-3 py-2">
                                <Etiqueta tono={v.version === a.version_actual ? 'ok' : 'neutro'}>
                                  v{v.version}
                                  {v.version === a.version_actual ? ' · actual' : ''}
                                </Etiqueta>
                              </td>
                              <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                                {cuando(v.creado_en)}
                              </td>
                              <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                                {v.autor ?? '—'}
                              </td>
                              <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                                {peso(v.tamano_bytes)}
                              </td>
                              <td
                                className="px-3 py-2 font-mono text-xs text-[var(--color-muted)]"
                                title={v.sha256}
                              >
                                {v.sha256.slice(0, 10)}…
                              </td>
                              <td className="px-3 py-2 text-right">
                                <form action={enlaceDeDescarga}>
                                  <input type="hidden" name="versionId" value={v.id} />
                                  <Boton
                                    variante="secundario"
                                    type="submit"
                                    className="px-2.5 py-1 text-xs"
                                    data-testid={`descargar-v${String(v.version)}`}
                                  >
                                    Descargar
                                  </Boton>
                                </form>
                              </td>
                            </tr>
                          ))}
                        </Tabla>

                        {administra && (
                          <form action={borrarArchivo} className="mt-3 flex justify-end">
                            <input type="hidden" name="archivoId" value={a.id} />
                            <Boton variante="peligro" type="submit" className="px-2.5 py-1 text-xs">
                              Borrar el archivo y todas sus versiones
                            </Boton>
                          </form>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </Tarjeta>
        );
      })}
    </div>
  );
}
