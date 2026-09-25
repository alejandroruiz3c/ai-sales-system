/**
 * `pnpm evals [plantilla…] [--acepto-bajada "motivo"]` (F2.7)
 *
 * Ejecuta las evals de promptfoo contra el modelo de verdad y guarda el
 * resultado sellado en `evals/resultados/<plantilla>.json`. Ese fichero es el
 * que comprueba `pnpm verify` en cada PR (`sello.test.ts`, ADR 0011).
 *
 * promptfoo se ejecuta con `pnpm dlx` y versión fija: no entra en el lockfile
 * ni en `pnpm audit`, y así su árbol de dependencias no puede tumbar el build.
 *
 * La clave del proveedor sale de `apps/web/.env.local` (el script de
 * `package.json` la carga con `--env-file-if-exists`). No se imprime nunca.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { elegirModelo } from '@sales-os/llm';

import { huellaDePlantilla } from '../src/plantilla.ts';
import {
  esIdDePlantilla,
  IDS_DE_PLANTILLA,
  PLANTILLAS,
  type IdDePlantilla,
} from '../src/registro.ts';
import { CASOS, HOY_DE_LAS_EVALS } from './casos.ts';
import {
  comprobarSello,
  huellaDeEvals,
  type DetalleDeCaso,
  type ResultadoSellado,
} from './sello.ts';

const VERSION_DE_PROMPTFOO = '0.123.1';
/** Salida de la herramienta. No es log: es lo que lee quien la ejecuta. */
const decir = (texto: string): boolean => process.stdout.write(`${texto}\n`);
const aqui = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url));

function argumentos(): { ids: IdDePlantilla[]; aceptoBajada?: string } {
  const args = process.argv.slice(2);
  const ids: IdDePlantilla[] = [];
  let aceptoBajada: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--acepto-bajada') {
      aceptoBajada = args[++i];
      if (aceptoBajada === undefined || aceptoBajada.trim() === '') {
        throw new Error('--acepto-bajada necesita el motivo entre comillas.');
      }
    } else if (esIdDePlantilla(a)) ids.push(a);
    else throw new Error(`No existe la plantilla «${a}». Hay: ${IDS_DE_PLANTILLA.join(', ')}.`);
  }
  return {
    ids: ids.length > 0 ? ids : [...IDS_DE_PLANTILLA],
    ...(aceptoBajada === undefined ? {} : { aceptoBajada }),
  };
}

function configDePromptfoo(id: IdDePlantilla): Record<string, unknown> {
  return {
    description: `SALES OS · evals de ${id}`,
    prompts: ['{{caso}}'],
    providers: [{ id: `file://${aqui('./proveedor.mjs')}`, label: `sales-os:${id}` }],
    defaultTest: { options: { provider: { id: `file://${aqui('./juez.mjs')}` } } },
    tests: CASOS[id].map((caso) => ({
      description: `${caso.id} · ${caso.descripcion}`,
      vars: {
        plantilla: id,
        caso: caso.id,
        perfil: caso.perfil ?? '',
        entrada: JSON.stringify(caso.entrada),
        hoy: HOY_DE_LAS_EVALS,
      },
      assert: [
        { type: 'javascript', value: `file://${aqui('./aserciones.mjs')}:comprobar` },
        ...(caso.rubrica === undefined ? [] : [{ type: 'llm-rubric', value: caso.rubrica }]),
      ],
    })),
  };
}

interface ResultadoDePromptfoo {
  readonly success: boolean;
  readonly vars?: Record<string, unknown>;
  readonly gradingResult?: { readonly reason?: string } | null;
  readonly error?: string | null;
}

function leerResultados(fichero: string): ResultadoDePromptfoo[] {
  const json = JSON.parse(readFileSync(fichero, 'utf8')) as {
    results?: { results?: ResultadoDePromptfoo[] };
  };
  return json.results?.results ?? [];
}

function evaluar(id: IdDePlantilla, aceptoBajada: string | undefined): boolean {
  const plantilla = PLANTILLAS[id];
  const temporal = aqui('./.tmp/');
  mkdirSync(temporal, { recursive: true });
  const config = `${temporal}${id}.json`;
  const salida = `${temporal}${id}.salida.json`;
  const registro = `${temporal}${id}.registro.jsonl`;
  for (const f of [salida, registro]) rmSync(f, { force: true });
  writeFileSync(config, JSON.stringify(configDePromptfoo(id), null, 2));

  decir(`▸ ${id}: ${String(CASOS[id].length)} casos con ${elegirModelo(plantilla.nivel).id}`);
  const r = spawnSync(
    'pnpm',
    [
      'dlx',
      `promptfoo@${VERSION_DE_PROMPTFOO}`,
      'eval',
      '-c',
      config,
      '-o',
      salida,
      '--no-cache',
      '--no-table',
      '--no-write',
      '-j',
      '4',
    ],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: {
        ...process.env,
        SALES_OS_EVALS_REGISTRO: registro,
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
      },
    },
  );
  // promptfoo sale con código distinto de cero cuando algún caso suspende; eso
  // no es un fallo de la ejecución. Sin fichero de salida, sí.
  if (!existsSync(salida)) {
    console.error(`✖ promptfoo no ha producido resultados (código ${String(r.status)}).`);
    return false;
  }

  const resultados = leerResultados(salida);
  const detalle: DetalleDeCaso[] = CASOS[id].map((caso) => {
    const hallado = resultados.find((x) => x.vars?.['caso'] === caso.id);
    return {
      caso: caso.id,
      aprobado: hallado?.success === true,
      motivo: (hallado?.error ?? hallado?.gradingResult?.reason ?? 'sin resultado').slice(0, 400),
    };
  });
  const coste = existsSync(registro)
    ? readFileSync(registro, 'utf8')
        .split('\n')
        .filter(Boolean)
        .reduce((t, linea) => t + (JSON.parse(linea) as { coste: number }).coste, 0)
    : 0;

  const codigoDelEvaluador = readFileSync(aqui('./evaluar.ts'), 'utf8');
  const huella = huellaDeEvals(plantilla, CASOS[id], codigoDelEvaluador);
  const fichero = aqui(`./resultados/${id}.json`);
  const previo = selloEnMain(id);
  const umbrales = (
    JSON.parse(readFileSync(aqui('./umbrales.json'), 'utf8')) as {
      umbrales: Record<string, number>;
    }
  ).umbrales;
  const umbral = umbrales[id];

  const aprobados = detalle.filter((d) => d.aprobado).length;
  const sello: ResultadoSellado = {
    plantilla: id,
    version: `${String(plantilla.version)}.${huellaDePlantilla(plantilla).slice(0, 8)}`,
    huella,
    modelo: elegirModelo(plantilla.nivel).id,
    fecha: new Date().toISOString(),
    casos: detalle.length,
    aprobados,
    puntuacion: aprobados / detalle.length,
    umbral: umbral ?? 0,
    costeEur: Math.round(coste * 1e6) / 1e6,
    // La comparación es con el resultado que hay en `main`, no con el último
    // fichero local: si fuera con el local, dos ejecuciones seguidas
    // «blanquearían» una bajada (la primera baja, la segunda compara con la
    // primera). Y con la última versión **distinta**: volver a evaluar lo mismo
    // que hay en main conserva su referencia anterior.
    anterior:
      previo === undefined
        ? null
        : previo.huella === huella
          ? previo.anterior
          : { puntuacion: previo.puntuacion, huella: previo.huella },
    aceptacionDeBajada:
      aceptoBajada === undefined ? null : { motivo: aceptoBajada, aceptadoPor: autor() },
    detalle,
  };
  writeFileSync(fichero, `${JSON.stringify(sello, null, 2)}\n`);

  for (const d of detalle)
    decir(`  ${d.aprobado ? '✔' : '✖'} ${d.caso}  ${d.aprobado ? '' : d.motivo}`);
  decir(
    `  ${String(aprobados)}/${String(detalle.length)} (${(sello.puntuacion * 100).toFixed(1)} %), umbral ${String(umbral)}, coste ${sello.costeEur.toFixed(4)} €`,
  );

  const errores = comprobarSello(plantilla, sello, umbral, huella);
  for (const e of errores) console.error(`  ✖ ${e}`);
  return errores.length === 0;
}

/**
 * El sello de una plantilla tal como está en `origin/main`.
 *
 * Es la referencia contra la que se mide una bajada. Si la plantilla es nueva
 * y aún no está en main, no hay referencia y no hay bajada posible.
 */
function selloEnMain(id: IdDePlantilla): ResultadoSellado | undefined {
  const r = spawnSync('git', ['show', `origin/main:packages/prompts/evals/resultados/${id}.json`], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return undefined;
  try {
    return JSON.parse(r.stdout) as ResultadoSellado;
  } catch {
    return undefined;
  }
}

function autor(): string {
  const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  return r.stdout.trim() || 'desconocido';
}

const { ids, aceptoBajada } = argumentos();
if ((process.env['ANTHROPIC_API_KEY'] ?? '') === '') {
  console.error(
    '✖ Falta ANTHROPIC_API_KEY. Tráela con: vercel env pull apps/web/.env.local --environment development',
  );
  process.exit(1);
}
let todoBien = true;
for (const id of ids) todoBien = evaluar(id, aceptoBajada) && todoBien;
process.exit(todoBien ? 0 : 1);
