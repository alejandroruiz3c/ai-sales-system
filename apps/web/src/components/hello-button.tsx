'use client';

import { useState } from 'react';

export function HelloButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/lab/hello', { method: 'POST' });
      const body = (await response.json()) as { sent?: boolean; error?: string; ids?: string[] };
      setMessage(
        body.sent === true
          ? `Evento aceptado por Inngest (${String(body.ids?.length ?? 0)} id). Mira el visor de abajo.`
          : `Inngest no ha aceptado el evento: ${body.error ?? 'sin detalle'}`,
      );
    } catch {
      setMessage('No se ha podido llamar al endpoint.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void send()}
        disabled={pending}
        data-testid="inngest-hello"
        className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {pending ? 'Enviando…' : 'Lanzar evento hello'}
      </button>
      {message ? (
        <p data-testid="inngest-hello-result" className="mt-3 text-sm text-[var(--color-muted)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
