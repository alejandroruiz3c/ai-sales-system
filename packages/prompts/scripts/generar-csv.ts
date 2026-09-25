/**
 * Regenera `src/fixtures/respuestas-t24.csv` a partir de la lista tipada.
 *
 *   pnpm --filter @sales-os/prompts fixtures:csv
 */

import { writeFileSync } from 'node:fs';

import { respuestasT24ComoCsv } from '../src/fixtures/respuestas-t24.ts';

const destino = new URL('../src/fixtures/respuestas-t24.csv', import.meta.url);
writeFileSync(destino, respuestasT24ComoCsv());
process.stdout.write(`✔ ${destino.pathname}\n`);
