import { FormularioDeEntrada } from '@/componentes/formulario-de-entrada.tsx';
import { sistemaVacio } from '@/acciones/arranque.ts';
import { Aviso } from '@/componentes/ui/index.tsx';

export const dynamic = 'force-dynamic';

export default async function PaginaDeEntrada({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;
  const vacio = await sistemaVacio().catch(() => false);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        SALES OS no tiene registro abierto. Se entra por invitación de un corporate.
      </p>

      {vacio && (
        <div className="mt-6">
          <Aviso tono="acento" titulo="El sistema está vacío">
            Todavía no hay ninguna persona dada de alta.{' '}
            <a href="/bienvenida" className="text-[var(--color-accent)] underline">
              Empieza por aquí
            </a>
            .
          </Aviso>
        </div>
      )}

      <div className="mt-6">
        <FormularioDeEntrada volver={volver ?? '/panel'} />
      </div>
    </>
  );
}
