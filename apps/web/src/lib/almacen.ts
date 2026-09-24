import 'server-only';

/**
 * Archivos del corporate en Supabase Storage (F1.5, F1.6).
 *
 * La ruta de un objeto empieza **siempre** por el uuid del corporate:
 * `{tenant_id}/{carpeta}/{version}-{nombre}`. Eso es lo que permite que la
 * política de `storage.objects` separe los ficheros igual que RLS separa las
 * filas (ADR 0003, punto 5), y lo que comprueba el trigger
 * `tenant_file_versions_ruta_valida` antes de aceptar una versión: una fila de
 * un corporate no puede apuntar a un objeto de otro ni por error.
 *
 * La subida y la descarga pasan por el servidor con la `service_role`, y no
 * desde el navegador con la clave anónima. Tres motivos, en orden de peso:
 *
 * 1. **La versión y la fila tienen que crearse juntas.** Si el navegador
 *    subiera el objeto y después llamara a la API para registrar la fila, un
 *    fallo entre las dos cosas deja un objeto huérfano que nadie ve y que sigue
 *    ocupando.
 * 2. **El sha256 se calcula en el servidor.** Calculado en el cliente sería un
 *    dato que el cliente afirma, y el historial de versiones dejaría de servir
 *    para comprobar que un archivo es el que dice ser.
 * 3. **La descarga se firma para un rato corto.** Una URL pública de Storage no
 *    caduca; una firmada sí, y además se puede registrar quién la pidió.
 *
 * El caso T1.3 depende de esto: el lector de un corporate que pega la URL de un
 * archivo de otro se topa con que la ruta de descarga comprueba la pertenencia
 * antes de firmar nada.
 */

import { createHash } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { env } from './env.ts';

export const BUCKET = 'tenants';

/** Cuánto vive una URL de descarga. Lo justo para que el navegador la use. */
const SEGUNDOS_DE_FIRMA = 60;

/** Tope por archivo. El mismo que tiene configurado el bucket. */
export const MAXIMO_BYTES = 50 * 1024 * 1024;

/**
 * Tipos que se aceptan.
 *
 * Es una lista blanca y no una lista negra: en F3 estos archivos los va a leer
 * un modelo, y lo que entra por aquí es contenido que no controlamos. Una lista
 * negra deja pasar todo lo que nadie pensó en prohibir.
 */
export const TIPOS_ACEPTADOS: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'text/csv': 'CSV',
  'application/json': 'JSON',
};

function cliente() {
  const clave = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (env.supabaseUrl === undefined || clave === undefined || clave.trim() === '') {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(env.supabaseUrl, clave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** El nombre con el que se guarda el objeto, con la ruta del corporate delante. */
export function rutaDeVersion(
  tenantId: string,
  carpeta: string,
  version: number,
  nombre: string,
): string {
  // El nombre visible se conserva en la base; en Storage se limpia, porque una
  // ruta con acentos, espacios o barras es una ruta que alguien va a escapar
  // mal algún día.
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${tenantId}/${carpeta}/v${String(version)}-${limpio === '' ? 'archivo' : limpio}`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function subirObjeto(ruta: string, bytes: Uint8Array, mime: string): Promise<void> {
  const { error } = await cliente()
    .storage.from(BUCKET)
    .upload(ruta, bytes, { contentType: mime, upsert: false });
  if (error !== null) throw new Error(`No se pudo subir el archivo: ${error.message}`);
}

export async function urlFirmada(ruta: string): Promise<string> {
  const { data, error } = await cliente()
    .storage.from(BUCKET)
    .createSignedUrl(ruta, SEGUNDOS_DE_FIRMA, { download: true });
  if (error !== null) throw new Error(`No se pudo firmar la descarga: ${error.message}`);
  return data.signedUrl;
}

export async function borrarObjetos(rutas: readonly string[]): Promise<void> {
  if (rutas.length === 0) return;
  const { error } = await cliente()
    .storage.from(BUCKET)
    .remove(rutas as string[]);
  if (error !== null) throw new Error(`No se pudieron borrar los objetos: ${error.message}`);
}
