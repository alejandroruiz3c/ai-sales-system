import { redirect } from 'next/navigation';

import { sistemaVacio } from '@/acciones/arranque.ts';
import { FormularioDeArranque } from '@/componentes/formulario-de-arranque.tsx';
import { Aviso } from '@/componentes/ui/index.tsx';
import { log } from '@/lib/log.ts';

export const dynamic = 'force-dynamic';

export default async function PaginaDeBienvenida() {
  // El `catch` deja rastro a propósito. Un `catch(() => null)` mudo cambia «no
  // se puede hablar con la base» por un mensaje genérico y borra la única pista
  // que había para saber por qué.
  const vacio = await sistemaVacio().catch((error: unknown) => {
    log().error('no se pudo comprobar si el sistema está vacío', {
      detalle: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (vacio === false) redirect('/entrar');

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Bienvenido a SALES OS</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        El sistema está vacío: no hay ningún corporate, ningún usuario y ningún dato de negocio. Es
        como tiene que empezar. Date de alta como administrador de la plataforma y después crearás
        tu primer corporate.
      </p>

      {vacio === null ? (
        <div className="mt-6">
          <Aviso tono="ko" titulo="No se puede hablar con la base de datos">
            Revisa <code className="font-mono">DATABASE_URL</code> en las variables del entorno.
          </Aviso>
        </div>
      ) : (
        <div className="mt-6">
          <FormularioDeArranque />
        </div>
      )}
    </>
  );
}
