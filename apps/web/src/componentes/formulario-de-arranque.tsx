'use client';

import { useActionState } from 'react';

import { crearPrimerAdministrador } from '@/acciones/arranque.ts';
import type { ResultadoDeAccion } from '@/acciones/sesion.ts';

import { Aviso, Boton, Campo, Entrada } from './ui/index.tsx';

const INICIAL: ResultadoDeAccion = {};

export function FormularioDeArranque() {
  const [estado, accion, enCurso] = useActionState(crearPrimerAdministrador, INICIAL);

  return (
    <form action={accion} className="space-y-4">
      <Campo etiqueta="Tu nombre">
        <Entrada name="nombre" required data-testid="arranque-nombre" />
      </Campo>

      <Campo etiqueta="Tu correo">
        <Entrada
          name="email"
          type="email"
          autoComplete="email"
          required
          data-testid="arranque-email"
        />
      </Campo>

      <Campo etiqueta="Contraseña" ayuda="Doce caracteres como mínimo.">
        <Entrada
          name="contrasena"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          data-testid="arranque-contrasena"
        />
      </Campo>

      <Campo etiqueta="Repite la contraseña">
        <Entrada
          name="repetida"
          type="password"
          autoComplete="new-password"
          required
          data-testid="arranque-repetida"
        />
      </Campo>

      <Campo
        etiqueta="Contraseña de administrador de plataforma"
        ayuda="La misma que abre /lab. Sin ella, cualquiera que llegue a esta URL se quedaría con el sistema."
      >
        <Entrada name="llave" type="password" required data-testid="arranque-llave" />
      </Campo>

      {estado.error !== undefined && (
        <Aviso tono="ko">
          <span data-testid="arranque-error">{estado.error}</span>
        </Aviso>
      )}

      <Boton type="submit" disabled={enCurso} className="w-full" data-testid="arranque-enviar">
        {enCurso ? 'Creando la cuenta…' : 'Crear mi cuenta y empezar'}
      </Boton>
    </form>
  );
}
