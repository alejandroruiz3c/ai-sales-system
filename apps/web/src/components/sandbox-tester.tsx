'use client';

import { OUTBOUND_CHANNELS, type OutboundChannel } from '@sales-os/integrations/sandbox';
import { useState } from 'react';

interface Decision {
  readonly allowed: boolean;
  readonly via?: string;
  readonly matchedRule?: string | null;
  readonly reason?: string;
  readonly message?: string;
}

const CHANNEL_LABEL: Record<OutboundChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  voice: 'Llamada',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  social: 'Redes sociales',
};

export function SandboxTester() {
  const [channel, setChannel] = useState<OutboundChannel>('email');
  const [recipient, setRecipient] = useState('director@empresa-real.es');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);

  async function check() {
    setPending(true);
    setDecision(null);
    try {
      const response = await fetch('/api/lab/sandbox-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, recipient }),
      });
      setDecision((await response.json()) as Decision);
    } catch {
      setDecision({ allowed: false, message: 'No se ha podido comprobar.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-5">
      <div className="flex flex-wrap gap-3">
        <select
          value={channel}
          onChange={(event) => {
            setChannel(event.target.value as OutboundChannel);
          }}
          data-testid="sandbox-channel"
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm"
        >
          {OUTBOUND_CHANNELS.map((option) => (
            <option key={option} value={option}>
              {CHANNEL_LABEL[option]}
            </option>
          ))}
        </select>

        <input
          value={recipient}
          onChange={(event) => {
            setRecipient(event.target.value);
          }}
          placeholder="destinatario"
          data-testid="sandbox-recipient"
          className="min-w-64 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
        />

        <button
          type="button"
          onClick={() => void check()}
          disabled={pending || recipient.trim() === ''}
          data-testid="sandbox-submit"
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Comprobando…' : 'Comprobar'}
        </button>
      </div>

      {decision ? (
        <div
          data-testid="sandbox-result"
          data-allowed={String(decision.allowed)}
          className={`mt-4 rounded-md border px-4 py-3 text-sm ${
            decision.allowed
              ? 'border-[var(--color-ok)] text-[var(--color-ok)]'
              : 'border-[var(--color-ko)] text-[var(--color-ko)]'
          }`}
        >
          <p className="font-medium">{decision.allowed ? 'Permitido' : 'Bloqueado'}</p>
          <p className="mt-1 text-[var(--color-muted)]">
            {decision.allowed
              ? `Vía ${decision.via ?? 'desconocida'}${
                  decision.matchedRule ? ` · regla «${decision.matchedRule}»` : ''
                }`
              : decision.message}
          </p>
          {decision.reason ? (
            <p className="mt-1 font-mono text-xs text-[var(--color-muted)]">{decision.reason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
