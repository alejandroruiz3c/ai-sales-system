import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { checkLabAccess } from '@/lib/lab-guard.ts';

export const dynamic = 'force-dynamic';

export default async function LabLayout({ children }: { children: ReactNode }) {
  const access = await checkLabAccess();

  if (access === 'no-habilitado') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-2xl font-semibold">Sala de pruebas no habilitada</h1>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Falta <span className="font-mono">LAB_ACCESS_PASSWORD</span> en este entorno. La sala no
          se abre sin protección: un panel de administración accesible por cualquiera es peor que no
          tenerlo.
        </p>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Configúrala en Vercel → Settings → Environment Variables, o en{' '}
          <span className="font-mono">.env.local</span> si estás en local.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm text-[var(--color-accent)]">
          ← Volver
        </Link>
      </main>
    );
  }

  if (access === 'sin-sesion') redirect('/lab/login');

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--color-line)] pb-5">
        <Link href="/" className="text-sm text-[var(--color-muted)] hover:text-white">
          ← SALES OS
        </Link>
        <span className="rounded-full border border-[var(--color-warn)] px-2 py-0.5 text-xs text-[var(--color-warn)]">
          solo administradores
        </span>
        <form action="/api/lab/logout" method="post" className="ml-auto">
          <button type="submit" className="text-sm text-[var(--color-muted)] hover:text-white">
            Salir
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
