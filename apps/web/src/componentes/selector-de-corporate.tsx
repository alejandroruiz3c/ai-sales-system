'use client';

import { useRef } from 'react';

import { cambiarDeTenant } from '@/acciones/sesion.ts';
import type { TenantDelUsuario } from '@/lib/sesion.ts';

/**
 * Cambiar de corporate (caso T1.1).
 *
 * Es un `select` dentro de un formulario que se envía solo. Podría ser un menú
 * desplegable más vistoso; es un `select` porque funciona con teclado, con
 * lector de pantalla y sin JavaScript, y porque es el control que un usuario ya
 * sabe usar sin que nadie se lo explique.
 */
export function SelectorDeCorporate({
  tenants,
  activo,
}: {
  tenants: readonly TenantDelUsuario[];
  activo: string;
}) {
  const formulario = useRef<HTMLFormElement>(null);

  return (
    <form action={cambiarDeTenant} ref={formulario}>
      <label className="sr-only" htmlFor="selector-corporate">
        Corporate activo
      </label>
      <select
        id="selector-corporate"
        name="tenantId"
        defaultValue={activo}
        data-testid="selector-corporate"
        onChange={() => formulario.current?.requestSubmit()}
        className="rounded-md border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-3 py-1.5 text-sm text-white outline-none transition focus:border-[var(--color-accent)]"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
            {t.esDemo ? ' · demo' : ''}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="ml-2 text-xs underline">
          Cambiar
        </button>
      </noscript>
    </form>
  );
}
