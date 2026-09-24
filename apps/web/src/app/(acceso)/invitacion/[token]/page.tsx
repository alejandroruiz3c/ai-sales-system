import Link from 'next/link';

import { leerInvitacion } from '@/acciones/invitaciones.ts';
import { FormularioDeInvitacion } from '@/componentes/formulario-de-invitacion.tsx';
import { Aviso } from '@/componentes/ui/index.tsx';
import { DESCRIPCION_DE_ROL, ETIQUETA_DE_ROL, type Rol } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

export default async function PaginaDeInvitacion({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitacion = await leerInvitacion(token).catch(() => ({ estado: 'desconocida' as const }));

  if (invitacion.estado !== 'valida') {
    const texto = {
      caducada: 'Esta invitación ha caducado. Pide una nueva a quien te invitó.',
      usada: 'Esta invitación ya se ha usado o se ha revocado.',
      desconocida: 'Este enlace no corresponde a ninguna invitación.',
    }[invitacion.estado];

    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Invitación</h1>
        <div className="mt-6">
          <Aviso tono="aviso">{texto}</Aviso>
        </div>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          <Link href="/entrar" className="text-[var(--color-accent)] underline">
            Entrar con una cuenta existente
          </Link>
        </p>
      </>
    );
  }

  const rol = (invitacion.rol ?? 'lector') as Rol;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Te han invitado a {invitacion.corporate}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Como <span className="text-white">{ETIQUETA_DE_ROL[rol]}</span>:{' '}
        {DESCRIPCION_DE_ROL[rol].toLowerCase()}.
      </p>

      <div className="mt-6">
        <FormularioDeInvitacion
          token={token}
          email={invitacion.email ?? ''}
          yaTieneCuenta={invitacion.yaTieneCuenta === true}
        />
      </div>
    </>
  );
}
