import 'server-only';

/**
 * La conexión a Postgres del panel, una por proceso.
 *
 * Next.js recarga módulos en caliente en desarrollo, y cada recarga crearía un
 * pool nuevo hasta agotar las conexiones del pooler. Se guarda en `globalThis`
 * por el mismo motivo que el anillo de eventos de F0.
 */

import { crearBaseDeDatos, type BaseDeDatos } from '@sales-os/db';

import { env } from './env.ts';
import { log } from './log.ts';

const global = globalThis as typeof globalThis & { __salesOsDb?: BaseDeDatos };

export function baseDeDatos(): BaseDeDatos {
  if (global.__salesOsDb !== undefined) return global.__salesOsDb;

  if (env.databaseUrl === undefined) {
    throw new Error(
      'Falta DATABASE_URL. En local sale de `vercel env pull apps/web/.env.local`; en Vercel, de las variables del proyecto.',
    );
  }

  global.__salesOsDb = crearBaseDeDatos({
    url: env.databaseUrl,
    // La URL del panel es la del pooler en modo transacción (puerto 6543).
    esPooler: true,
    maxConexiones: 5,
    // Cada uso de la llave maestra se registra. Si el registro se llena de
    // líneas, es que hay un camino que debería ir por `conRLS` y no va.
    registrarUsoDeSistema: (motivo) => {
      log().warn('acceso con service_role', { motivo });
    },
  });

  return global.__salesOsDb;
}
