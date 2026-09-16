import Link from 'next/link';

import { isLabConfigured } from '@/lib/lab-auth.ts';

export const dynamic = 'force-dynamic';

export default async function LabLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (!isLabConfigured()) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-2xl font-semibold">Sala de pruebas no habilitada</h1>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Falta <span className="font-mono">LAB_ACCESS_PASSWORD</span> en este entorno.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Sala de pruebas</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Acceso restringido. En F1 esto pasa a ser el rol <span className="font-mono">admin</span> de
        Supabase Auth; hasta entonces, contraseña de entorno.
      </p>

      <form action="/api/lab/login" method="post" className="mt-8 space-y-3">
        <label htmlFor="password" className="block text-sm">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          data-testid="lab-password"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Entrar
        </button>
      </form>

      {error ? (
        <p data-testid="lab-login-error" className="mt-4 text-sm text-[var(--color-ko)]">
          Contraseña incorrecta.
        </p>
      ) : null}

      <Link href="/" className="mt-10 inline-block text-sm text-[var(--color-muted)]">
        ← Volver
      </Link>
    </main>
  );
}
