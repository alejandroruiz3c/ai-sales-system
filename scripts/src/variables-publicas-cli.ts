/**
 * F0.7 · `pnpm variables-publicas` y `pnpm verify:bundle`
 *
 * Sin argumentos, revisa las variables `NEXT_PUBLIC_*` del entorno y falla si
 * alguna contiene un secreto. En local casi no hay ninguna, así que pasa de
 * largo: el sitio donde esta comprobación cuenta es el build de Vercel, que sí
 * las tiene todas.
 *
 * Con `--bundle <carpeta>`, rastrea el JavaScript ya construido buscando
 * secretos. Es la misma comprobación que se hizo a mano tras el incidente del
 * 2026-09-18 —descargar el bundle de staging y buscar el token dentro—, pero
 * automática y antes de desplegar. Corre **después** de `next build`.
 *
 * La lógica está en `variables-publicas.ts`, que es la que tiene tests.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

import {
  analizar,
  analizarBundle,
  formatearInforme,
  formatearInformeDeBundle,
  type FicheroConstruido,
} from './variables-publicas.ts';

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Todo el JavaScript y los mapas de la carpeta de salida, recursivamente. */
function ficherosServidos(raiz: string): FicheroConstruido[] {
  const encontrados: FicheroConstruido[] = [];
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (actual === undefined) continue;
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      const ruta = join(actual, entrada.name);
      if (entrada.isDirectory()) {
        pendientes.push(ruta);
        continue;
      }
      if (!/\.(?:js|mjs|json|html|txt)$/.test(entrada.name)) continue;
      // Un mapa de fuentes puede llevar el código original entero dentro, así
      // que también cuenta como "servido al navegador".
      encontrados.push({
        ruta: relative(process.cwd(), ruta),
        contenido: readFileSync(ruta, 'utf8'),
      });
    }
  }
  return encontrados;
}

function principal(): void {
  const carpeta = argumento('--bundle');

  if (carpeta === undefined) {
    const revisadas = Object.keys(process.env).filter((n) => n.startsWith('NEXT_PUBLIC_')).length;
    const hallazgos = analizar(process.env);
    process.stdout.write(formatearInforme(hallazgos, revisadas));
    process.exitCode = hallazgos.length === 0 ? 0 : 1;
    return;
  }

  try {
    statSync(carpeta);
  } catch {
    // No haber construido todavía no es una fuga. Se dice y se sale en verde,
    // porque este modo se engancha detrás del build y no debe romper a quien
    // ejecute `pnpm verify` sin haber construido.
    process.stdout.write(
      `· No hay nada construido en ${carpeta}: no hay bundle que revisar. Ejecuta pnpm build primero.\n`,
    );
    return;
  }

  const ficheros = ficherosServidos(carpeta);
  const bytes = ficheros.reduce((total, f) => total + f.contenido.length, 0);
  const hallazgos = analizarBundle(ficheros);
  process.stdout.write(formatearInformeDeBundle(hallazgos, ficheros.length, bytes));
  process.exitCode = hallazgos.length === 0 ? 0 : 1;
}

principal();
