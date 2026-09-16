/**
 * Worker de navegador de SALES OS.
 *
 * Corre en Hetzner con Docker, un perfil de Chromium persistente por cuenta y
 * una IP estática por cuenta. Vercel no puede hacer esto: no mantiene sesiones
 * de navegador vivas ni IPs fijas (plan §0, decisión de arquitectura 1).
 *
 * Esqueleto reservado en F0. Se implementa en F8 (LinkedIn) y F12 (opinión).
 */

export const workerInfo = {
  name: '@sales-os/worker-browser',
  runtime: 'node' as const,
  host: 'hetzner' as const,
  phase: 'F8',
};

export function describeWorker(): string {
  return `${workerInfo.name} · host ${workerInfo.host} · se implementa en ${workerInfo.phase}`;
}

if (process.argv[1]?.endsWith('main.ts')) {
  // eslint-disable-next-line no-console
  console.log(describeWorker());
}
