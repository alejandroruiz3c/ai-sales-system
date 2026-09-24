'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { aceptarInvitacion } from '@/acciones/invitaciones.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

export function FormularioDeInvitacion({
  token,
  email,
  yaTieneCuenta,
}: {
  token: string;
  email: string;
  yaTieneCuenta: boolean;
}) {
  const [estado, accion, enCurso] = useActionState(aceptarInvitacion, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Campo etiqueta="Correo" ayuda="Es el correo al que se envió la invitación y no se cambia.">
        <Entrada value={email} readOnly disabled data-testid="invitacion-email" />
      </Campo>

      {yaTieneCuenta ? (
        <Aviso tono="acento">
          Ya tienes cuenta en SALES OS.{' '}
          <Link href="/entrar" className="text-[var(--color-accent)] underline">
            Entra
          </Link>{' '}
          y vuelve a abrir este enlace para aceptar.
        </Aviso>
      ) : (
        <>
          <Campo etiqueta="Tu nombre">
            <Entrada name="nombre" required minLength={2} data-testid="invitacion-nombre" />
          </Campo>
          <Campo etiqueta="Elige una contraseña" ayuda="Doce caracteres como mínimo.">
            <Entrada
              name="contrasena"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              data-testid="invitacion-contrasena"
            />
          </Campo>
          <Campo etiqueta="Repítela">
            <Entrada
              name="repetida"
              type="password"
              autoComplete="new-password"
              required
              data-testid="invitacion-repetida"
            />
          </Campo>
        </>
      )}

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="invitacion-error">{estado.error}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} className="w-full" data-testid="invitacion-aceptar">
        {enCurso ? 'Aceptando…' : 'Aceptar la invitación'}
      </Boton>
    </form>
  );
}
