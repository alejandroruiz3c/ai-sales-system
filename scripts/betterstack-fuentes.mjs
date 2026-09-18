#!/usr/bin/env node
/**
 * Gestiona las fuentes de logs de Better Stack (F0.11).
 *
 * Existe porque las fuentes se crearon a mano en la región `us_west`, y el
 * ADR 0002 obliga a que ningún dato salga de la UE. La región de una fuente
 * **se elige al crearla y no se puede cambiar después**, así que hay que crear
 * fuentes nuevas y migrar las variables; dejar eso en un script es lo que hace
 * que sea repetible y auditable en lugar de una tarde de clics.
 *
 *   node scripts/betterstack-fuentes.mjs --token-file <ruta> --listar
 *   node scripts/betterstack-fuentes.mjs --token-file <ruta> --asegurar
 *   node scripts/betterstack-fuentes.mjs --token-file <ruta> --volcar <carpeta>
 *   node scripts/betterstack-fuentes.mjs --token-file <ruta> --archivar <id>
 *
 * El token se lee de un fichero, nunca de un argumento ni de una variable de
 * entorno: un argumento se ve en `ps` y queda en el historial del shell.
 *
 * **Este script no imprime nunca un token de fuente ni un host de ingesta.**
 * `--volcar` los escribe en ficheros dentro de la carpeta indicada, para poder
 * pasarlos a `vercel env add` por entrada estándar. Borra esa carpeta después.
 *
 * API: https://betterstack.com/docs/logs/api/create-a-source/
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const API = 'https://telemetry.betterstack.com/api/v2/sources';

/** `germany` es Núremberg, y es la región de la UE (ADR 0002). */
const REGION_UE = 'germany';

/**
 * `http` es la fuente de ingesta genérica por HTTP, que es como envía
 * `@sales-os/core`: un POST de JSON al host de ingesta con el token en
 * `Authorization`.
 */
const PLATAFORMA = 'http';

/** Las fuentes que este proyecto necesita: una por entorno, nunca compartidas. */
const FUENTES = [
  { nombre: 'ai-sales-staging-eu', para: 'staging, previews y desarrollo' },
  { nombre: 'ai-sales-prod-eu', para: 'producción real (se usa desde F14.3)' },
];

function argumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? undefined : process.argv[i + 1];
}

function token() {
  const ruta = argumento('--token-file');
  if (ruta === undefined) {
    throw new Error('Falta --token-file <ruta>. El token no se pasa por argumento ni por entorno.');
  }
  const valor = readFileSync(ruta, 'utf8').trim();
  if (valor === '') throw new Error(`El fichero ${ruta} está vacío.`);
  return valor;
}

async function api(metodo, ruta, cuerpo, autorizacion) {
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${autorizacion}`,
      'content-type': 'application/json',
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    // El cuerpo de un error de Better Stack no lleva secretos, pero sí puede
    // llevar el nombre del equipo: se recorta.
    throw new Error(
      `HTTP ${String(respuesta.status)} en ${metodo} ${ruta}: ${texto.slice(0, 300)}`,
    );
  }
  return texto === '' ? {} : JSON.parse(texto);
}

/** Todas las fuentes del equipo, paginando. */
async function listar(autorizacion) {
  const todas = [];
  let pagina = 1;
  for (;;) {
    const respuesta = await api(
      'GET',
      `?page=${String(pagina)}&per_page=50`,
      undefined,
      autorizacion,
    );
    const datos = respuesta.data ?? [];
    todas.push(...datos);
    if (datos.length < 50) break;
    pagina += 1;
  }
  return todas;
}

/** Solo metadatos: ni token de fuente ni host de ingesta. */
function describir(fuente) {
  const a = fuente.attributes ?? {};
  const region = a.data_region ?? '(sin región)';
  const enLaUe = String(region).startsWith('eu-');
  return `  ${enLaUe ? '🇪🇺' : '🇺🇸'} #${String(fuente.id)}  ${String(a.name)}  ·  región ${String(region)}  ·  plataforma ${String(a.platform)}`;
}

async function asegurar(autorizacion) {
  const existentes = await listar(autorizacion);
  const porNombre = new Map(existentes.map((f) => [f.attributes?.name, f]));

  for (const { nombre, para } of FUENTES) {
    const ya = porNombre.get(nombre);
    if (ya !== undefined) {
      console.log(`  = «${nombre}» ya existía`);
      console.log(describir(ya));
      continue;
    }
    const creada = await api(
      'POST',
      '',
      { name: nombre, platform: PLATAFORMA, data_region: REGION_UE },
      autorizacion,
    );
    console.log(`  + «${nombre}» creada para ${para}`);
    console.log(describir(creada.data));
  }
}

/**
 * Escribe el token y el host de cada fuente en ficheros, para pasarlos a
 * `vercel env add` por entrada estándar sin que pasen por el terminal.
 */
async function volcar(autorizacion, carpeta) {
  mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  const existentes = await listar(autorizacion);
  for (const { nombre } of FUENTES) {
    const fuente = existentes.find((f) => f.attributes?.name === nombre);
    if (fuente === undefined) {
      console.log(`  ✖ «${nombre}» no existe todavía`);
      continue;
    }
    const a = fuente.attributes ?? {};
    writeFileSync(join(carpeta, `${nombre}.token`), String(a.token), { mode: 0o600 });
    writeFileSync(join(carpeta, `${nombre}.host`), String(a.ingesting_host), { mode: 0o600 });
    console.log(`  ✔ «${nombre}»: token y host escritos en la carpeta indicada (no se imprimen)`);
  }
}

async function principal() {
  const autorizacion = token();

  if (process.argv.includes('--listar')) {
    const fuentes = await listar(autorizacion);
    console.log(`  ${String(fuentes.length)} fuente(s) en el equipo:`);
    for (const fuente of fuentes) console.log(describir(fuente));
    return;
  }

  if (process.argv.includes('--asegurar')) {
    await asegurar(autorizacion);
    return;
  }

  const carpeta = argumento('--volcar');
  if (carpeta !== undefined) {
    await volcar(autorizacion, carpeta);
    return;
  }

  const id = argumento('--archivar');
  if (id !== undefined) {
    await api('DELETE', `/${id}`, undefined, autorizacion);
    console.log(`  ✔ fuente #${id} eliminada`);
    return;
  }

  console.log('Usa --listar, --asegurar, --volcar <carpeta> o --archivar <id>.');
  process.exitCode = 1;
}

principal().catch((error) => {
  console.error('\nHa fallado:', error.message);
  process.exit(1);
});
