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
 * se borra antes de arrancar Playwright.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const URL_POR_DEFECTO = 'https://staging.sales.turbineh.com';

/**
 * El entorno *Production* de este proyecto de Vercel es el que sirve staging
 * (ver `infra/vercel/README.md`). Si eso cambia, cambia aquí.
 */
const ENTORNO_DE_STAGING = 'production';

function log(mensaje) {
  console.log(`▸ ${mensaje}`);
}

/** Lee una variable del entorno de Vercel sin dejarla en disco ni imprimirla. */
function secretoDeVercel(nombre) {
  const carpeta = mkdtempSync(join(tmpdir(), 'sales-os-e2e-'));
  const fichero = join(carpeta, '.env');
  try {
    const resultado = spawnSync(
      'vercel',
      ['env', 'pull', fichero, '--environment', ENTORNO_DE_STAGING, '--yes'],
      { stdio: 'ignore' },
    );
    if (resultado.status !== 0) return undefined;

    for (const linea of readFileSync(fichero, 'utf8').split('\n')) {
      const separador = linea.indexOf('=');
      if (separador === -1) continue;
      if (linea.slice(0, separador).trim() !== nombre) continue;
      return linea
        .slice(separador + 1)
        .trim()
        .replace(/^"(.*)"$/s, '$1');
    }
    return undefined;
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

function principal() {
  const baseUrl = process.env['E2E_BASE_URL'] ?? URL_POR_DEFECTO;
  log(`Objetivo: ${baseUrl}`);

  const entorno = { ...process.env, E2E_BASE_URL: baseUrl };

  if (entorno['E2E_LAB_PASSWORD'] === undefined) {
    log(`Leyendo LAB_ACCESS_PASSWORD del entorno ${ENTORNO_DE_STAGING} de Vercel`);
    const password = secretoDeVercel('LAB_ACCESS_PASSWORD');
    if (password === undefined) {
      console.warn(
        '  No se ha podido leer. Los tests de /lab se omitirán.\n' +
          '  Si los necesitas: vercel login, o exporta E2E_LAB_PASSWORD a mano.',
      );
    } else {
      entorno['E2E_LAB_PASSWORD'] = password;
      log('Contraseña de /lab cargada en memoria (no se ha escrito en ningún sitio)');
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
