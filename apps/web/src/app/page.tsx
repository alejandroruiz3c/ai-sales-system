import Link from 'next/link';

import { appVersion, env } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';

const ENV_LABEL: Record<string, string> = {
  dev: 'desarrollo',
  preview: 'preview',
  staging: 'staging',
  production: 'producción',
};

export default function HomePage() {
  const version = appVersion();
  const environment = ENV_LABEL[env.salesOsEnv] ?? env.salesOsEnv;

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-muted)]">
        TurbineH
      </p>

      <h1 className="mt-3 text-5xl font-semibold tracking-tight">SALES OS v0</h1>

      <p className="mt-4 max-w-xl text-lg text-[var(--color-muted)]">
        Sistema de ventas agéntico multi-corporate. Esto es el entregable de la fase F0: el
        repositorio, la integración continua y este entorno vivo.
      </p>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
        {[
          { label: 'Versión', value: version, testId: 'version' },
          { label: 'Entorno', value: environment, testId: 'environment' },
          { label: 'Fase', value: 'F0', testId: 'phase' },
          { label: 'Rama', value: env.commitRef ?? 'local', testId: 'branch' },
        ].map((item) => (
          <div key={item.label} className="bg-[var(--color-ink-soft)] px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
              {item.label}
            </dt>
            <dd className="mt-1 font-mono text-sm" data-testid={item.testId}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <nav className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/status"
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Estado de los servicios
        </Link>
        <Link
          href="/lab"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-white"
        >
          Sala de pruebas
        </Link>
      </nav>

      <section className="mt-14 border-t border-[var(--color-line)] pt-8 text-sm text-[var(--color-muted)]">
        <h2 className="text-sm font-semibold text-white">Qué hay y qué no</h2>
        <ul className="mt-3 space-y-2">
          <li>
            <span className="text-white">Hay:</span> monorepo, CI, modo sandbox con lista blanca,
            página de estado y el esqueleto de la sala de pruebas.
          </li>
          <li>
            <span className="text-white">No hay todavía:</span> tenants, login, agentes ni flujo de
            ventas. Eso empieza en F1, y solo cuando Alex dé el GO F0.
          </li>
        </ul>
      </section>
    </main>
  );
}
