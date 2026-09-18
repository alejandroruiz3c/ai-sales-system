/**
 * El logger del panel (F0.11).
 *
 * La lógica está en `@sales-os/core`, que no conoce su runtime. Aquí solo se le
 * da la configuración leída del entorno: es el único sitio del panel que sabe
 * que Better Stack existe.
 *
 * Si `BETTER_STACK_SOURCE_TOKEN` o `BETTER_STACK_INGESTING_HOST` no están, el
 * log sigue funcionando y solo escribe en consola. No es un fallo: en local no
 * hay por qué mandar logs a un tercero.
 */

import { crearLogger, type Logger } from '@sales-os/core';

import { appVersion, env } from './env.ts';

let instancia: Logger | undefined;

export function log(): Logger {
  instancia ??= crearLogger({
    service: 'web',
    environment: env.salesOsEnv,
    version: appVersion(),
    ...(env.betterStackSourceToken === undefined
      ? {}
      : { sourceToken: env.betterStackSourceToken }),
    ...(env.betterStackIngestingHost === undefined
      ? {}
      : { ingestingHost: env.betterStackIngestingHost }),
  });
  return instancia;
}
