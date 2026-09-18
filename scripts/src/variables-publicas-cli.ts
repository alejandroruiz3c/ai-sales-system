/**
 * F0.7 · `pnpm variables-publicas`
 *
 * Revisa las variables `NEXT_PUBLIC_*` del entorno en el que se ejecuta y falla
 * si alguna contiene un secreto. La lógica está en `variables-publicas.ts`, que
 * es la que tiene tests.
 *
 * En local casi no hay variables de estas, así que pasa de largo: el sitio donde
 * esta comprobación cuenta es el build de Vercel, que sí las tiene todas.
 */

import process from 'node:process';

import { analizar, formatearInforme } from './variables-publicas.ts';

const revisadas = Object.keys(process.env).filter((n) => n.startsWith('NEXT_PUBLIC_')).length;
const hallazgos = analizar(process.env);

process.stdout.write(formatearInforme(hallazgos, revisadas));
process.exitCode = hallazgos.length === 0 ? 0 : 1;
