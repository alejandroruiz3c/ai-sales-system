#!/usr/bin/env node
/**
 * `pnpm e2e:staging` · lanza los E2E de fase contra staging desde local.
 *
 * Existe porque GitHub Actions está bloqueado a nivel de cuenta y el plan (§5B.2)
 * exige que los E2E de cada fase corran **contra el entorno real**, no contra un
 * servidor local. Cuando Actions vuelva, el job `e2e` de `ci.yml` hace lo mismo
 * y este script sigue sirviendo para reproducir un fallo en el sitio.
 *
 *   pnpm e2e:staging                      # toda la suite contra staging
 *   pnpm e2e:staging --grep F0            # solo los de F0
 *   E2E_BASE_URL=https://otra pnpm e2e:staging
 *
 * La contraseña de `/lab` no se pide ni se escribe en ningún sitio: se lee del
 * entorno de Vercel, se pasa al proceso hijo por memoria y el fichero temporal
 * se borra antes de arrancar Playwright. Si en Vercel está como tipo *Secret* y
 * no se puede leer, lo dice y explica cómo pasarla a mano.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const URL_POR_DEFECTO = 'https://staging.sales.turbineh.com';

/**
 * El entorno *Production* de este proyecto de Vercel es el que sirve staging
 * (ADR 0008). Si eso cambia, cambia aquí — la subtarea F14.3b lo hará.
 *
 * Se consultan dos entornos en este orden porque una variable de tipo *Secret*
 * en Vercel **no se puede volver a leer**: `vercel env pull` devuelve el literal
 * `[SENSITIVE]` en su lugar. Los tres entornos comparten el mismo valor, así que
 * si Production está como Secret, Development sirve igual.
 */
const ENTORNOS_A_CONSULTAR = ['production', 'development'];

/** Lo que Vercel devuelve en lugar del valor de una variable de tipo Secret. */
const MARCADOR_DE_SECRETO = '[SENSITIVE]';

function log(mensaje) {
  console.log(`▸ ${mensaje}`);
}

/** Lee una variable de un entorno de Vercel sin dejarla en disco ni imprimirla. */
function deUnEntorno(nombre, entorno) {
  const carpeta = mkdtempSync(join(tmpdir(), 'sales-os-e2e-'));
  const fichero = join(carpeta, '.env');
  try {
    const resultado = spawnSync(
      'vercel',
      ['env', 'pull', fichero, '--environment', entorno, '--yes'],
      { stdio: 'ignore' },
    );
    if (resultado.status !== 0) return undefined;

    for (const linea of readFileSync(fichero, 'utf8').split('\n')) {
      const separador = linea.indexOf('=');
      if (separador === -1) continue;
      if (linea.slice(0, separador).trim() !== nombre) continue;
      const valor = linea
        .slice(separador + 1)
        .trim()
        .replace(/^"(.*)"$/s, '$1');
      // Una variable de tipo Secret no se puede leer: Vercel devuelve el
      // marcador. Intentarlo como contraseña daría un fallo de login
      // desconcertante en vez de un aviso claro.
      if (valor === MARCADOR_DE_SECRETO || valor === '') return undefined;
      return valor;
    }
    return undefined;
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

/** Prueba los entornos por orden y devuelve el primer valor legible. */
function secretoDeVercel(nombre) {
  for (const entorno of ENTORNOS_A_CONSULTAR) {
    const valor = deUnEntorno(nombre, entorno);
    if (valor !== undefined) return { valor, entorno };
  }
  return undefined;
}

function principal() {
  const baseUrl = process.env['E2E_BASE_URL'] ?? URL_POR_DEFECTO;
  log(`Objetivo: ${baseUrl}`);

  const entorno = { ...process.env, E2E_BASE_URL: baseUrl };

  if (entorno['E2E_LAB_PASSWORD'] === undefined) {
    log('Buscando LAB_ACCESS_PASSWORD en los entornos de Vercel');
    const encontrado = secretoDeVercel('LAB_ACCESS_PASSWORD');
    if (encontrado === undefined) {
      console.warn(
        '  No se ha podido leer de ningún entorno, así que los tests de /lab van a fallar.\n' +
          '  Suele ser porque la variable está como tipo Secret en Vercel, y esas no se\n' +
          '  pueden volver a leer. Ejecuta el comando así, con el valor de KEYS.rtf:\n' +
          '\n' +
          '    E2E_LAB_PASSWORD=<la contraseña> pnpm e2e:staging\n',
      );
    } else {
      entorno['E2E_LAB_PASSWORD'] = encontrado.valor;
      log(
        `Contraseña de /lab cargada en memoria desde el entorno «${encontrado.entorno}» (no se ha escrito en ningún sitio)`,
      );
    }
  }

  const argumentos = ['--filter', '@sales-os/web', 'exec', 'playwright', 'test'];
  const resultado = spawnSync('pnpm', [...argumentos, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: entorno,
  });
  process.exit(resultado.status ?? 1);
}

principal();
