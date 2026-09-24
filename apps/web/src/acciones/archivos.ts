'use server';

/**
 * Subir, reemplazar, descargar y borrar archivos del corporate (F1.5, F1.6).
 *
 * El caso T1.4 es el que manda en el diseño: subir un PDF a `context/`,
 * reemplazarlo, abrir el historial y **poder descargar la versión anterior**.
 * De ahí que reemplazar no sobrescriba nada: crea la versión siguiente y deja
 * la anterior en su sitio, con su ruta y su sha256.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { baseDeDatos } from '../lib/base-de-datos.ts';
import {
  borrarObjetos,
  MAXIMO_BYTES,
  rutaDeVersion,
  sha256,
  subirObjeto,
  TIPOS_ACEPTADOS,
  urlFirmada,
} from '../lib/almacen.ts';
import { fichero, texto } from '../lib/formularios.ts';
import { puedeEditar, sesionActual } from '../lib/sesion.ts';
import type { ResultadoDeAccion } from './sesion.ts';

const CARPETAS = ['context', 'inputs', 'outputs'] as const;
type Carpeta = (typeof CARPETAS)[number];

function esCarpeta(valor: string): valor is Carpeta {
  return (CARPETAS as readonly string[]).includes(valor);
}

export async function subirArchivo(
  _previo: ResultadoDeAccion,
  datos: FormData,
): Promise<ResultadoDeAccion> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');

  const carpeta = texto(datos, 'carpeta', 'context');
  const descripcion = texto(datos, 'descripcion').trim();
  const archivo = fichero(datos, 'archivo');
  const tenantId = sesion.tenant.id;

  if (!esCarpeta(carpeta)) return { error: 'Esa carpeta no existe.' };
  if (!puedeEditar(sesion.tenant.rol)) {
    return { error: 'Subir archivos exige ser editor del corporate o más.' };
  }
  if (archivo === undefined) return { error: 'Elige un archivo.' };
  if (archivo.size > MAXIMO_BYTES) {
    return {
      error: `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo son ${String(MAXIMO_BYTES / 1024 / 1024)} MB.`,
    };
  }

  const mime = archivo.type === '' ? 'application/octet-stream' : archivo.type;
  if (!(mime in TIPOS_ACEPTADOS)) {
    return {
      error: `Tipo no aceptado (${mime}). Se aceptan: ${Object.values(TIPOS_ACEPTADOS).join(', ')}.`,
    };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const huella = sha256(bytes);
  const nombre = archivo.name;

  try {
    const resultado = await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
      // Una fila por archivo lógico: si ya existe, esto es un reemplazo y la
      // versión sube. `on conflict` sobre el índice parcial de no borrados.
      const archivoFila = await ctx.unaFila<{ id: string; version_actual: number }>(
        `insert into public.tenant_files (tenant_id, carpeta, nombre, descripcion, creado_por)
         values ($1, $2, $3, nullif($4, ''), auth.uid())
         on conflict (tenant_id, carpeta, lower(nombre)) where borrado_en is null
           do update set descripcion = coalesce(nullif($4, ''), public.tenant_files.descripcion)
         returning id, version_actual`,
        [tenantId, carpeta, nombre, descripcion],
      );
      if (archivoFila === undefined) throw new Error('No se pudo registrar el archivo');

      const version = archivoFila.version_actual + 1;
      const ruta = rutaDeVersion(tenantId, carpeta, version, nombre);

      // El objeto se sube **antes** de apuntar la versión. Si la subida falla,
      // no queda fila apuntando a un objeto que no existe; si falla el apunte,
      // queda un objeto sin fila, que es un desperdicio y no una mentira.
      await subirObjeto(ruta, bytes, mime);

      await ctx.consultar(
        `insert into public.tenant_file_versions
           (tenant_id, file_id, version, ruta, tamano_bytes, mime, sha256, subido_por)
         values ($1, $2, $3, $4, $5, $6, $7, auth.uid())`,
        [tenantId, archivoFila.id, version, ruta, bytes.byteLength, mime, huella],
      );

      await ctx.consultar(`update public.tenant_files set version_actual = $2 where id = $1`, [
        archivoFila.id,
        version,
      ]);

      await ctx.consultar(
        `select app.registrar_evento($1::uuid, $2::text,
           jsonb_build_object('carpeta', $3::text, 'nombre', $4::text, 'version', $5::int),
           'sistema', 'panel')`,
        [tenantId, version === 1 ? 'file.uploaded' : 'file.replaced', carpeta, nombre, version],
      );

      return { version };
    });

    revalidatePath('/panel/archivos');
    return {
      ok:
        resultado.version === 1
          ? `«${nombre}» subido a ${carpeta}/.`
          : `«${nombre}» reemplazado: ahora es la versión ${String(resultado.version)}. La anterior sigue descargable.`,
    };
  } catch (error) {
    const mensaje = (error as Error).message;
    if (/row-level security/i.test(mensaje)) {
      return { error: 'Subir archivos exige ser editor del corporate o más.' };
    }
    return { error: `No se pudo subir: ${mensaje}` };
  }
}

/**
 * Devuelve una URL firmada para descargar una versión concreta.
 *
 * Aquí está la mitad del caso T1.3: la pertenencia se comprueba **con RLS**
 * antes de firmar nada. Un lector de un corporate que pegue el identificador de
 * una versión de otro no obtiene la fila, así que no hay nada que firmar.
 */
export async function enlaceDeDescarga(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');
  const versionId = texto(datos, 'versionId');

  const fila = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.unaFila<{ ruta: string }>(
      `select v.ruta from public.tenant_file_versions v where v.id = $1 and v.tenant_id = $2`,
      [versionId, sesion.tenant?.id],
    ),
  );

  if (fila === undefined) {
    // Mismo destino para «no existe» y «no es tuyo». Distinguirlos convertiría
    // esta ruta en una forma de averiguar qué archivos tiene otro corporate.
    redirect('/panel/archivos?error=no-encontrado');
  }

  redirect(await urlFirmada(fila.ruta));
}

export async function borrarArchivo(datos: FormData): Promise<void> {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/entrar');
  const archivoId = texto(datos, 'archivoId');
  const tenantId = sesion.tenant.id;

  const rutas = await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => {
    const filas = await ctx.consultar<{ ruta: string }>(
      `select ruta from public.tenant_file_versions where file_id = $1 and tenant_id = $2`,
      [archivoId, tenantId],
    );
    const archivo = await ctx.unaFila<{ nombre: string; carpeta: string }>(
      `select nombre, carpeta from public.tenant_files where id = $1 and tenant_id = $2`,
      [archivoId, tenantId],
    );
    if (archivo === undefined) return [];

    await ctx.consultar(`delete from public.tenant_files where id = $1 and tenant_id = $2`, [
      archivoId,
      tenantId,
    ]);
    await ctx.consultar(
      `select app.registrar_evento($1::uuid, 'file.deleted',
         jsonb_build_object('carpeta', $2::text, 'nombre', $3::text, 'versiones', $4::int),
         'sistema', 'panel')`,
      [tenantId, archivo.carpeta, archivo.nombre, filas.length],
    );
    return filas.map((f) => f.ruta);
  });

  // Los objetos se borran después de que la transacción haya cerrado: si se
  // borraran dentro y el `commit` fallara, las filas seguirían apuntando a
  // objetos que ya no están.
  if (rutas.length > 0) await borrarObjetos(rutas);
  revalidatePath('/panel/archivos');
}
