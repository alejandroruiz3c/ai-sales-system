#!/usr/bin/env node
/**
 * `pnpm db:migrar` · aplica las migraciones pendientes.
 *
 *   pnpm db:migrar                 # aplica lo que falte
 *   pnpm db:migrar --listar        # dice qué falta y no toca nada
 *
 * Usa `DATABASE_DIRECT_URL` si está, y `DATABASE_URL` si no. La conexión
 * directa es la correcta para migrar: el pooler en modo transacción no admite
 * sentencias como `create index concurrently` ni conserva estado de sesión, y
 * una migración a medias es peor que una que no arranca.
 *
 * No imprime la cadena de conexión, ni completa ni recortada: lleva la
 * contraseña de la base (regla permanente 4). Imprime el host, que es lo que
 * hace falta para saber contra qué entorno estás.
 */

import process from 'node:process';

import { aplicarMigraciones, cargarMigraciones } from '../migraciones.ts';
import { crearEjecutorPostgres } from './ejecutor-postgres.ts';

/** La salida de una herramienta de línea de órdenes es su interfaz, así que va
 * por `stdout` y no por el log estructurado, igual que en `scripts/src`. */
function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(cadena de conexión con formato desconocido)';
  }
}

async function principal(): Promise<void> {
  const url = process.env['DATABASE_DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    console.error(
      [
        'Falta DATABASE_DIRECT_URL (o DATABASE_URL) en el entorno.',
        '',
        'En local: ponla en .env.local. El valor está en KEYS.rtf, bloque SUPABASE,',
        'como "Direct connection string" del proyecto que corresponda.',
        'En Vercel: vercel env add DATABASE_DIRECT_URL',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const migraciones = cargarMigraciones();
  const soloListar = process.argv.includes('--listar');
  const ejecutor = crearEjecutorPostgres(url);

  escribir(`▸ Base: ${hostDe(url)}`);
  escribir(`▸ ${String(migraciones.length)} migraciones en el repositorio`);

  try {
    if (soloListar) {
      const aplicadas = await ejecutor
        .consultar<{ nombre: string }>('select nombre from app.migraciones order by nombre')
        .catch(() => []);
      const nombres = new Set(aplicadas.map((f) => f.nombre));
      for (const migracion of migraciones) {
        escribir(`  ${nombres.has(migracion.nombre) ? '✔' : '·'} ${migracion.nombre}`);
      }
      const pendientes = migraciones.filter((m) => !nombres.has(m.nombre)).length;
      escribir(pendientes === 0 ? '\n✔ Nada pendiente.' : `\n${String(pendientes)} pendientes.`);
      return;
    }

    const resultado = await aplicarMigraciones(ejecutor, migraciones);

    for (const nombre of resultado.aplicadas) escribir(`  + ${nombre}`);
    escribir(
      resultado.aplicadas.length === 0
        ? '\n✔ La base ya estaba al día.'
        : `\n✔ ${String(resultado.aplicadas.length)} migraciones aplicadas.`,
    );
  } finally {
    await ejecutor.cerrar();
  }
}

await principal();
