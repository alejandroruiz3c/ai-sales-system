import Link from 'next/link';
import type { ReactNode } from 'react';

export default function LayoutDeAcceso({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link
        href="/"
        className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:text-white"
      >
        SALES OS
      </Link>
      <div className="mt-6">{children}</div>
    </main>
  );
}
