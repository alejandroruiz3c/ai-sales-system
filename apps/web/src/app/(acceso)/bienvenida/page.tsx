import { redirect } from 'next/navigation';

import { sistemaVacio } from '@/acciones/arranque.ts';
import { FormularioDeArranque } from '@/componentes/formulario-de-arranque.tsx';
import { Aviso } from '@/componentes/ui/index.tsx';

export const dynamic = 'force-dynamic';

export default async function PaginaDeBienvenida() {
  const vacio = await sistemaVacio().catch(() => null);

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
