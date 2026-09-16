'use client';

import { useEffect, useState } from 'react';

import type { EventKind, SystemEvent } from '@/lib/events.ts';

const KIND_COLOR: Record<EventKind, string> = {
  sistema: 'text-[var(--color-muted)]',
  sandbox: 'text-[var(--color-warn)]',
  inngest: 'text-[var(--color-accent)]',
  error: 'text-[var(--color-ko)]',
  aprobacion: 'text-[var(--color-ok)]',
  coste: 'text-[var(--color-ok)]',
};

export function EventViewer({ initialEvents }: { initialEvents: readonly SystemEvent[] }) {
  const [events, setEvents] = useState<readonly SystemEvent[]>(initialEvents);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch('/api/lab/events', { cache: 'no-store' });
          if (!response.ok) return;
          const body = (await response.json()) as { events: SystemEvent[] };
          setEvents(body.events);
        } catch {
          // El visor no es crítico: si un sondeo falla, se reintenta al siguiente.
        }
      })();
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [live]);

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-2 text-xs">
        <span className="text-[var(--color-muted)]" data-testid="event-count">
          {events.length} evento{events.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => {
            setLive((value) => !value);
          }}
          className="ml-auto text-[var(--color-muted)] hover:text-white"
        >
          {live ? '⏸ pausar' : '▶ en vivo'}
        </button>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-muted)]">
          Todavía no hay eventos. Prueba el interceptor de sandbox o lanza el evento hello.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]" data-testid="event-list">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs">
                <span className="text-[var(--color-muted)]">
                  {new Date(event.at).toLocaleTimeString('es-ES')}
                </span>
                <span className={KIND_COLOR[event.kind]}>{event.name}</span>
                <span className="text-[var(--color-muted)]">tenant: {event.tenantId}</span>
                <span className="text-[var(--color-muted)]">agente: {event.agent}</span>
              </div>
              <p className="mt-1">{event.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
