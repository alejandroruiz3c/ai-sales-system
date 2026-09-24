'use client';

import { useActionState } from 'react';

import { entrar, type ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

export function FormularioDeEntrada({ volver }: { volver: string }) {
  const [estado, accion, enCurso] = useActionState(entrar, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="volver" value={volver} />

      <Campo etiqueta="Correo">
        <Entrada
          name="email"
          type="email"
          autoComplete="email"
          required
          data-testid="entrar-email"
        />
      </Campo>

      <Campo etiqueta="Contraseña">
        <Entrada
          name="contrasena"
          type="password"
          autoComplete="current-password"
          required
          data-testid="entrar-contrasena"
        />
      </Campo>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="entrar-error">{estado.error}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} className="w-full" data-testid="entrar-enviar">
        {enCurso ? 'Entrando…' : 'Entrar'}
      </Boton>
    </form>
  );
}
