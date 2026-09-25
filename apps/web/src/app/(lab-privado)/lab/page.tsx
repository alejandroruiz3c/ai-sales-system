import { EventViewer } from '@/components/event-viewer.tsx';
import { HelloButton } from '@/components/hello-button.tsx';
import { SandboxTester } from '@/components/sandbox-tester.tsx';
import { LotesDeModelos } from '@/componentes/lotes-de-modelos.tsx';
import { NuevoCorporateDePrueba } from '@/componentes/nuevo-corporate-de-prueba.tsx';
import { ProbadorDeAgente } from '@/componentes/probador-de-agente.tsx';
import { ProbadorDeModelos } from '@/componentes/probador-de-modelos.tsx';
import { ResetDePruebas } from '@/componentes/reset-de-pruebas.tsx';
import { Tarjeta } from '@/componentes/ui/index.tsx';
import { env } from '@/lib/env.ts';
import { listEvents } from '@/lib/events.ts';
import { corporatesDePrueba } from '@/lib/lab-pruebas.ts';
import { langfuseConfigurado, tipoDeCambio } from '@/lib/llm.ts';

export const dynamic = 'force-dynamic';

/** Herramientas de `/lab` previstas en el plan (§5B.2) y cuándo llegan. */
const HERRAMIENTAS_PENDIENTES = [
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
    nombre: 'Batería de seguridad',
    detalle: 'Fuga entre tenants e inyección de instrucciones',
    fase: 'F13',
  },
];

export default async function LabPage() {
  const events = listEvents(50);
  // Si la base todavía no está configurada, la sala sigue sirviendo para lo de
  // F0. Enseñar una lista vacía es mejor que un 500 en la única pantalla desde
  // la que se diagnostica el entorno.
  const corporates = await corporatesDePrueba().catch(() => []);

  return (
    <main className="py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Sala de pruebas</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
        Crece fase a fase. F2 añade el probador de modelos y el modo lote; de F1 siguen el agente
        ficticio de prueba, el reset del entorno de pruebas, el visor de eventos, el probador del
        interceptor de sandbox y la prueba de humo de Inngest. Entorno{' '}
        <span className="font-mono text-white">{env.salesOsEnv}</span>.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Probador de modelos</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
          Una llamada real a través del router de modelos, cobrada en el presupuesto del corporate
          de prueba elegido. Enseña el modelo que el router ha elegido para el nivel de la tarea, el
          coste en euros (tipo de cambio {tipoDeCambio().toLocaleString('es-ES')} € por dólar), si
          hubo acierto de caché y cuántos intentos hicieron falta.{' '}
          {langfuseConfigurado()
            ? 'Cada llamada deja su traza en Langfuse, separada por tenant y agente.'
            : 'Langfuse no está configurado en este entorno: las llamadas no dejan traza.'}
        </p>
        {!env.anthropicApiKey && (
          <p className="mt-3 text-sm text-[var(--color-ko)]">
            Falta ANTHROPIC_API_KEY en este entorno: el probador responderá que los modelos no están
            configurados.
          </p>
        )}
        <div className="mt-4 space-y-4">
          <Tarjeta>
            <NuevoCorporateDePrueba />
          </Tarjeta>
          <Tarjeta>
            <ProbadorDeModelos corporates={corporates} />
          </Tarjeta>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Modo lote</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
          Clasifica las 20 respuestas del fichero de prueba por la Batch API, que cobra la mitad.
          Inngest recoge el lote cuando termina (normalmente en unos minutos) y aquí aparece
          corregido caso por caso contra la categoría esperada.
        </p>
        <div className="mt-4">
          <Tarjeta>
            <LotesDeModelos corporates={corporates} />
          </Tarjeta>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Agente de prueba</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
          Un agente ficticio que genera una acción inofensiva. Sirve para comprobar la cola de
          aprobaciones, el corte de presupuesto y el nivel de autonomía sin tocar a ningún prospecto
          ni gastar en modelos: la llamada de prueba no llama a ningún modelo, pide permiso al
          presupuesto y apunta 0,05 € fijos, para que el caso T1.8 siga siendo aritmética exacta.
        </p>
        <div className="mt-4">
          <Tarjeta>
            <ProbadorDeAgente corporates={corporates} />
          </Tarjeta>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Reset del entorno de pruebas</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-muted)]">
          Deja el sistema como recién instalado para poder repetir el kit entero desde T1.0.
        </p>
        <div className="mt-4">
          <Tarjeta>
            <ResetDePruebas />
          </Tarjeta>
        </div>
      </section>

      <section className="mt-12">
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
