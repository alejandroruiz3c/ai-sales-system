'use client';

import { useState } from 'react';

interface Result {
  readonly ok: boolean;
  readonly message: string;
}

export function TestErrorButton() {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  async function launch() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch('/api/status/test-error', { method: 'POST' });
      const body = (await response.json()) as { eventId?: string; reported?: boolean };
      setResult({
        ok: body.reported === true,
        message:
          body.reported === true
            ? `Error lanzado y enviado a Sentry (id ${body.eventId ?? 'sin id'}). Compruébalo en Sentry.`
            : 'Error lanzado, pero Sentry no está configurado en este entorno, así que no se ha reportado.',
      });
    } catch {
      setResult({ ok: false, message: 'No se ha podido llamar al endpoint de prueba.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void launch()}
        disabled={pending}
        data-testid="launch-test-error"
        className="rounded-md border border-[var(--color-ko)] px-4 py-2 text-sm font-medium text-[var(--color-ko)] transition hover:bg-[var(--color-ko)] hover:text-white disabled:opacity-50"
      >
        {pending ? 'Lanzando…' : 'Lanzar error de prueba'}
      </button>
      {result ? (
        <p
          data-testid="test-error-result"
          className={`mt-3 text-sm ${result.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]'}`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
