import Link from 'next/link';

import { TestErrorButton } from '@/components/test-error-button.tsx';
import { getStatusReport, type ServiceState } from '@/lib/status.ts';

export const dynamic = 'force-dynamic';

const DOT: Record<ServiceState, string> = {
  ok: 'bg-[var(--color-ok)]',
  error: 'bg-[var(--color-ko)]',
  'no-configurado': 'bg-[var(--color-warn)]',
};

const LABEL: Record<ServiceState, string> = {
  ok: 'En verde',
  error: 'Fallo',
  'no-configurado': 'No configurado',
};

export default async function StatusPage() {
  const report = await getStatusReport();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-[var(--color-muted)] hover:text-white">
        ← SALES OS v0
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Estado de los servicios</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Entorno <span className="font-mono text-white">{report.environment}</span> · versión{' '}
        <span className="font-mono text-white">{report.version}</span> · comprobado a las{' '}
        {new Date(report.generatedAt).toLocaleTimeString('es-ES')}
      </p>

      <ul className="mt-8 space-y-px overflow-hidden rounded-lg border border-[var(--color-line)]">
        {report.services.map((service) => (
          <li
            key={service.id}
            data-testid={`service-${service.id}`}
            data-state={service.state}
            className="bg-[var(--color-ink-soft)] px-5 py-4"
          >
            <div className="flex items-center gap-3">
              <span className={`size-2.5 shrink-0 rounded-full ${DOT[service.state]}`} />
              <span className="font-medium">{service.name}</span>
              <span className="ml-auto text-xs uppercase tracking-wider text-[var(--color-muted)]">
                {LABEL[service.state]}
                {service.latencyMs !== undefined ? ` · ${String(service.latencyMs)} ms` : ''}
              </span>
            </div>

            <p className="mt-2 pl-[22px] text-sm text-[var(--color-muted)]">{service.detail}</p>

            {service.missing && service.missing.length > 0 ? (
              <p className="mt-2 pl-[22px] text-xs text-[var(--color-muted)]">
                Falta:{' '}
                <span className="font-mono text-[var(--color-warn)]">
                  {service.missing.join(', ')}
                </span>
                {service.where ? <> · configúralo en {service.where}</> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <section className="mt-10 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-5">
        <h2 className="text-sm font-semibold">Modo sandbox</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]" data-testid="sandbox-state">
          {report.sandbox.enabled ? (
            <>
              <span className="text-[var(--color-ok)]">Activo.</span> Ningún contacto saliente sale
              de aquí si el destinatario no está en la lista blanca ({report.sandbox.allowlistSize}{' '}
              entradas válidas).
            </>
          ) : (
            <>
              <span className="text-[var(--color-ko)]">Desactivado.</span> Este entorno puede
              escribir a destinatarios reales.
            </>
          )}
        </p>
        {report.sandbox.ignoredDisableRequest ? (
          <p className="mt-2 text-sm text-[var(--color-warn)]">
            Alguien ha pedido desactivar el sandbox con SANDBOX_MODE=off en un entorno que no es
            producción. La petición se ha ignorado.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-5">
        <h2 className="text-sm font-semibold">Comprobar Sentry de verdad</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Un DSN válido no demuestra que los errores lleguen. Este botón lanza un error real en el
          servidor; tiene que aparecer en Sentry en menos de un minuto (caso T0.6).
        </p>
        <div className="mt-4">
          <TestErrorButton />
        </div>
      </section>

      <p className="mt-8 text-xs text-[var(--color-muted)]">
        En JSON:{' '}
        <Link href="/api/status" className="font-mono underline hover:text-white">
          /api/status
        </Link>
      </p>
    </main>
  );
}
