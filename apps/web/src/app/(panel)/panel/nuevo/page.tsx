import { FormularioDeCorporate } from '@/componentes/formulario-de-corporate.tsx';
import { Aviso, Tarjeta } from '@/componentes/ui/index.tsx';

export const dynamic = 'force-dynamic';

export default function PaginaDeCorporateNuevo() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Crea tu primer corporate</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Un corporate es una empresa con su propio equipo, sus archivos, sus credenciales y su
        presupuesto. Está aislado del resto: nada de lo que entre aquí lo puede ver otro.
      </p>

      <div className="mt-6">
        <Aviso tono="acento" titulo="Aquí no se configura qué vendes">
          Esto solo crea el contenedor. Qué vende el corporate, a quién y con qué argumentos lo
          decide el onboarding, que llega en F3 a partir de su deck, su web y su argumentario. El
          sistema no trae precargado ni un precio.
        </Aviso>
      </div>

      <Tarjeta className="mt-6">
        <FormularioDeCorporate />
      </Tarjeta>
    </div>
  );
}
