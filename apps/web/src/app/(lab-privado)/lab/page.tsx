import { EventViewer } from '@/components/event-viewer.tsx';
import { HelloButton } from '@/components/hello-button.tsx';
import { SandboxTester } from '@/components/sandbox-tester.tsx';
import { env } from '@/lib/env.ts';
import { listEvents } from '@/lib/events.ts';

export const dynamic = 'force-dynamic';

/** Herramientas de `/lab` previstas en el plan (§5B.2) y cuándo llegan. */
const HERRAMIENTAS_PENDIENTES = [
  {
    nombre: 'Probador de modelos',
    detalle: 'Prompt, modelo elegido, coste y si usó caché',
    fase: 'F2',
  },
  {
    nombre: 'Inyector de prospectos',
    detalle: 'Pegar un CSV o JSON y meterlo en el flujo',
    fase: 'F5',
  },
  {
    nombre: 'Simulador de respuestas',
    detalle: 'Simular interesado, baja, fuera de oficina…',
    fase: 'F6',
  },
  { nombre: 'Reloj acelerado', detalle: 'Comprimir las esperas de las secuencias', fase: 'F6' },
  {
    nombre: 'Reset del tenant de pruebas',
    detalle: 'Dejar el tenant demo en su estado inicial',
    fase: 'F1',
  },
  {
    nombre: 'Batería de seguridad',
    detalle: 'Fuga entre tenants e inyección de instrucciones',
    fase: 'F13',
  },
];

export default function LabPage() {
  const events = listEvents(50);

  return (
    <main className="py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Sala de pruebas</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
        Crece fase a fase. En F0 tiene el visor de eventos, el probador del interceptor de sandbox y
        la prueba de humo de Inngest. Entorno{' '}
        <span className="font-mono text-white">{env.salesOsEnv}</span>.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Interceptor de modo sandbox</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Comprueba una decisión sin enviar nada. Un destinatario que no esté en la lista blanca
          tiene que quedar bloqueado con su motivo.
        </p>
        <div className="mt-4">
          <SandboxTester />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Prueba de humo de Inngest</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Lanza el evento <span className="font-mono">sales-os/hello.requested.v1</span>. Si Inngest
          está conectado, la función se ejecuta y su resultado aparece abajo en el visor.
        </p>
        <div className="mt-4">
          <HelloButton />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Visor de eventos</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Cada evento con su tenant, su agente y su mensaje. En F0 el registro es en memoria del
          proceso; la tabla <span className="font-mono">events</span> append-only llega en F1.10.
        </p>
        <div className="mt-4">
          <EventViewer initialEvents={events} />
        </div>
      </section>

      <section className="mt-12 border-t border-[var(--color-line)] pt-6">
        <h2 className="text-lg font-medium">Pendiente en fases siguientes</h2>
        <ul className="mt-4 space-y-px overflow-hidden rounded-lg border border-[var(--color-line)]">
          {HERRAMIENTAS_PENDIENTES.map((tool) => (
            <li
              key={tool.nombre}
              className="flex flex-wrap items-baseline gap-x-3 bg-[var(--color-ink-soft)] px-4 py-3 text-sm"
            >
              <span className="font-medium">{tool.nombre}</span>
              <span className="text-[var(--color-muted)]">{tool.detalle}</span>
              <span className="ml-auto font-mono text-xs text-[var(--color-accent)]">
                {tool.fase}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
