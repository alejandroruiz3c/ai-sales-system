import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { salir } from '@/acciones/sesion.ts';
import { SelectorDeCorporate } from '@/componentes/selector-de-corporate.tsx';
import { Etiqueta } from '@/componentes/ui/index.tsx';
import { env } from '@/lib/env.ts';
import { ETIQUETA_DE_ROL, sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

const NAVEGACION = [
  { href: '/panel', texto: 'Inicio' },
  { href: '/panel/archivos', texto: 'Archivos' },
  { href: '/panel/configuracion', texto: 'Configuración' },
  { href: '/panel/aprobaciones', texto: 'Aprobaciones' },
  { href: '/panel/eventos', texto: 'Eventos' },
  { href: '/panel/equipo', texto: 'Equipo' },
  { href: '/panel/ajustes', texto: 'Ajustes' },
] as const;

export default async function LayoutDelPanel({ children }: { children: ReactNode }) {
  const sesion = await sesionActual();
  if (sesion === undefined) redirect('/entrar');

  // Sin corporate no hay navegación que enseñar: el sistema nace vacío y lo
  // primero es crear uno (caso T1.0).
  const activo = sesion.tenant;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <Link href="/panel" className="text-sm font-semibold tracking-tight text-white">
            SALES OS
          </Link>

          {activo !== undefined && (
            <SelectorDeCorporate tenants={sesion.tenants} activo={activo.id} />
          )}

          <div className="ml-auto flex items-center gap-3 text-xs text-[var(--color-muted)]">
            {env.salesOsEnv !== 'production' && <Etiqueta tono="aviso">{env.salesOsEnv}</Etiqueta>}
            {activo !== undefined && (
              <Etiqueta tono="acento" data-testid="rol-actual">
                {ETIQUETA_DE_ROL[activo.rol]}
              </Etiqueta>
            )}
            <span data-testid="usuario-actual">{sesion.nombre}</span>
            <form action={salir}>
              <button type="submit" className="transition hover:text-white">
                Salir
              </button>
            </form>
          </div>
        </div>

        {activo !== undefined && (
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-1">
            {NAVEGACION.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-ink-soft)] hover:text-white"
              >
                {item.texto}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
