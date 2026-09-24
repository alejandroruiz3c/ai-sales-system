/**
 * Piezas de interfaz compartidas del panel.
 *
 * El plan pide shadcn/ui, cuya idea es que los componentes **se copian al
 * repositorio** en lugar de venir de una dependencia que dicta el diseño. Esto
 * es esa idea llevada a lo que F1 necesita: nueve piezas, sin dependencias, con
 * las variables de color que ya define `globals.css`. Cuando llegue el Estudio
 * (F2B) y haga falta de verdad el catálogo completo, se trae con su CLI y estas
 * se sustituyen sin tocar las pantallas, porque la superficie es la misma.
 */

import type { ComponentProps, ReactNode } from 'react';

export function Tarjeta({
  titulo,
  descripcion,
  acciones,
  children,
  ...props
}: {
  titulo?: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
} & ComponentProps<'section'>) {
  return (
    <section
      {...props}
      className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] ${props.className ?? ''}`}
    >
      {(titulo !== undefined || acciones !== undefined) && (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            {titulo !== undefined && <h2 className="text-base font-medium text-white">{titulo}</h2>}
            {descripcion !== undefined && (
              <p className="mt-1 text-sm text-[var(--color-muted)]">{descripcion}</p>
            )}
          </div>
          {acciones}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

type VarianteBoton = 'principal' | 'secundario' | 'peligro' | 'discreto';

const ESTILO_BOTON: Record<VarianteBoton, string> = {
  principal: 'bg-[var(--color-accent)] text-white hover:opacity-90',
  secundario:
    'border border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-white',
  peligro: 'border border-[var(--color-ko)] text-[var(--color-ko)] hover:bg-[var(--color-ko)]/10',
  discreto: 'text-[var(--color-muted)] hover:text-white',
};

export function Boton({
  variante = 'principal',
  ...props
}: { variante?: VarianteBoton } & ComponentProps<'button'>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${ESTILO_BOTON[variante]} ${props.className ?? ''}`}
    />
  );
}

export function Campo({
  etiqueta,
  ayuda,
  error,
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white">{etiqueta}</span>
      {ayuda !== undefined && (
        <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{ayuda}</span>
      )}
      <div className="mt-1.5">{children}</div>
      {error !== undefined && error !== '' && (
        <span role="alert" className="mt-1.5 block text-xs text-[var(--color-ko)]">
          {error}
        </span>
      )}
    </label>
  );
}

const ESTILO_ENTRADA =
  'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm text-white outline-none transition placeholder:text-[var(--color-muted)]/60 focus:border-[var(--color-accent)] disabled:opacity-50';

export function Entrada(props: ComponentProps<'input'>) {
  return <input {...props} className={`${ESTILO_ENTRADA} ${props.className ?? ''}`} />;
}

export function AreaDeTexto(props: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...props}
      className={`${ESTILO_ENTRADA} font-mono leading-relaxed ${props.className ?? ''}`}
    />
  );
}

export function Seleccion(props: ComponentProps<'select'>) {
  return <select {...props} className={`${ESTILO_ENTRADA} ${props.className ?? ''}`} />;
}

type TonoEtiqueta = 'neutro' | 'ok' | 'aviso' | 'ko' | 'acento';

const ESTILO_ETIQUETA: Record<TonoEtiqueta, string> = {
  neutro: 'border-[var(--color-line)] text-[var(--color-muted)]',
  ok: 'border-[var(--color-ok)]/40 text-[var(--color-ok)]',
  aviso: 'border-[var(--color-warn)]/40 text-[var(--color-warn)]',
  ko: 'border-[var(--color-ko)]/40 text-[var(--color-ko)]',
  acento: 'border-[var(--color-accent)]/40 text-[var(--color-accent)]',
};

export function Etiqueta({
  tono = 'neutro',
  children,
  ...props
}: { tono?: TonoEtiqueta } & ComponentProps<'span'>) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${ESTILO_ETIQUETA[tono]} ${props.className ?? ''}`}
    >
      {children}
    </span>
  );
}

export function Aviso({
  tono = 'neutro',
  titulo,
  children,
}: {
  tono?: TonoEtiqueta;
  titulo?: string;
  children: ReactNode;
}) {
  const borde: Record<TonoEtiqueta, string> = {
    neutro: 'border-[var(--color-line)]',
    ok: 'border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5',
    aviso: 'border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5',
    ko: 'border-[var(--color-ko)]/40 bg-[var(--color-ko)]/5',
    acento: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5',
  };
  return (
    <div role="status" className={`rounded-md border px-4 py-3 text-sm ${borde[tono]}`}>
      {titulo !== undefined && <p className="font-medium text-white">{titulo}</p>}
      <div className={`text-[var(--color-muted)] ${titulo === undefined ? '' : 'mt-1'}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * Lo que se enseña cuando no hay nada.
 *
 * Tiene su propio componente porque en SALES OS el estado vacío es el estado
 * inicial de todo: el sistema nace sin corporates, sin archivos y sin eventos
 * (regla permanente 3). Una tabla vacía sin explicación parece un fallo; con
 * una frase y un botón, es un paso del recorrido.
 */
export function Vacio({
  titulo,
  children,
  accion,
}: {
  titulo: string;
  children?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--color-line)] px-6 py-12 text-center">
      <p className="text-sm font-medium text-white">{titulo}</p>
      {children !== undefined && (
        <p className="max-w-md text-sm text-[var(--color-muted)]">{children}</p>
      )}
      {accion}
    </div>
  );
}

export function Tabla({
  cabeceras,
  children,
}: {
  cabeceras: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            {cabeceras.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">{children}</tbody>
      </table>
    </div>
  );
}
