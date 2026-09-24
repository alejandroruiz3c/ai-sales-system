import { redirect } from 'next/navigation';

import { cambiarRol, quitarMiembro, revocarInvitacion } from '@/acciones/corporates.ts';
import { FormularioDeInvitar } from '@/componentes/formulario-de-invitar.tsx';
import {
  Aviso,
  Boton,
  Etiqueta,
  Seleccion,
  Tabla,
  Tarjeta,
  Vacio,
} from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import {
  DESCRIPCION_DE_ROL,
  ETIQUETA_DE_ROL,
  puedeAdministrar,
  ROLES_DEL_PANEL,
  sesionActual,
  type Rol,
} from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

interface FilaDeMiembro {
  usuario_id: string;
  rol: Rol;
  nombre: string | null;
  email: string;
  creado_en: string;
}

interface FilaDeInvitacion {
  id: string;
  email: string;
  rol: Rol;
  expira_en: string;
  vencida: boolean;
}

function fecha(valor: string): string {
  return new Date(valor).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function PaginaDeEquipo() {
  const sesion = await sesionActual();
  if (sesion?.tenant === undefined) redirect('/panel');

  const tenantId = sesion.tenant.id;
  const administra = puedeAdministrar(sesion.tenant.rol);

  const { miembros, invitaciones } = await baseDeDatos().conRLS(sesion.usuario.id, async (ctx) => ({
    miembros: await ctx.consultar<FilaDeMiembro>(
      `select m.usuario_id, m.rol, p.nombre, p.email, m.creado_en::text as creado_en
         from public.memberships m
         join public.perfiles p on p.id = m.usuario_id
         where m.tenant_id = $1 and m.estado = 'activa'
         order by case m.rol
           when 'propietario' then 1 when 'administrador' then 2
           when 'editor' then 3 else 4 end, p.email`,
      [tenantId],
    ),
    // Un lector no ve las invitaciones: la política de `invitaciones` solo
    // deja leerlas a un administrador, así que esto devuelve vacío sin
    // necesidad de comprobar nada aquí.
    invitaciones: await ctx.consultar<FilaDeInvitacion>(
      `select id, email, rol, expira_en::text as expira_en, expira_en < now() as vencida
         from public.invitaciones
         where tenant_id = $1 and estado = 'pendiente'
         order by creada_en desc`,
      [tenantId],
    ),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Quién puede entrar en {sesion.tenant.nombre} y con qué permisos.
        </p>
      </div>

      {!administra && (
        <Aviso tono="neutro" titulo="Estás como lector">
          Ves el equipo y no lo puedes cambiar. Invitar a alguien o cambiar un rol exige ser
          administrador del corporate, y eso lo decide la base de datos, no esta pantalla.
        </Aviso>
      )}

      <Tarjeta titulo="Personas" descripcion={`${String(miembros.length)} con acceso`}>
        <Tabla cabeceras={['Persona', 'Correo', 'Rol', 'Desde', '']}>
          {miembros.map((m) => {
            const esYo = m.usuario_id === sesion.usuario.id;
            return (
              <tr key={m.usuario_id}>
                <td className="px-3 py-2.5 text-white">
                  {m.nombre ?? '—'}
                  {esYo && <span className="ml-2 text-xs text-[var(--color-muted)]">(tú)</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-[var(--color-muted)]">
                  {m.email}
                </td>
                <td className="px-3 py-2.5">
                  {administra && !esYo ? (
                    <form action={cambiarRol} className="inline-flex">
                      <input type="hidden" name="usuarioId" value={m.usuario_id} />
                      <Seleccion
                        name="rol"
                        defaultValue={m.rol}
                        className="py-1 text-xs"
                        data-testid={`rol-${m.email}`}
                        // Sin JavaScript el botón de al lado lo envía igual.
                      >
                        {ROLES_DEL_PANEL.map((r) => (
                          <option key={r} value={r}>
                            {ETIQUETA_DE_ROL[r]}
                          </option>
                        ))}
                      </Seleccion>
                      <Boton variante="discreto" type="submit" className="px-2 text-xs">
                        Guardar
                      </Boton>
                    </form>
                  ) : (
                    <Etiqueta tono={m.rol === 'lector' ? 'neutro' : 'acento'}>
                      {ETIQUETA_DE_ROL[m.rol]}
                    </Etiqueta>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">
                  {fecha(m.creado_en)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {administra && !esYo && m.rol !== 'propietario' && (
                    <form action={quitarMiembro}>
                      <input type="hidden" name="usuarioId" value={m.usuario_id} />
                      <Boton variante="discreto" type="submit" className="px-2 text-xs">
                        Quitar
                      </Boton>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </Tabla>

        <dl className="mt-5 grid gap-2 border-t border-[var(--color-line)] pt-4 text-xs sm:grid-cols-2">
          {ROLES_DEL_PANEL.map((r) => (
            <div key={r} className="flex gap-2">
              <dt className="shrink-0 font-medium text-white">{ETIQUETA_DE_ROL[r]}:</dt>
              <dd className="text-[var(--color-muted)]">{DESCRIPCION_DE_ROL[r]}</dd>
            </div>
          ))}
        </dl>
      </Tarjeta>

      {administra && (
        <Tarjeta
          titulo="Invitar a alguien"
          descripcion="Se crea un enlace que tienes que hacerle llegar tú. El sistema no manda correos todavía."
        >
          <FormularioDeInvitar />
        </Tarjeta>
      )}

      {administra && (
        <Tarjeta titulo="Invitaciones pendientes">
          {invitaciones.length === 0 ? (
            <Vacio titulo="No hay invitaciones pendientes">
              Cuando invites a alguien, aparecerá aquí hasta que acepte o caduque.
            </Vacio>
          ) : (
            <Tabla cabeceras={['Correo', 'Rol', 'Caduca', '']}>
              {invitaciones.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2.5 font-mono text-xs text-white">{i.email}</td>
                  <td className="px-3 py-2.5">
                    <Etiqueta>{ETIQUETA_DE_ROL[i.rol]}</Etiqueta>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {i.vencida ? (
                      <Etiqueta tono="ko">Vencida</Etiqueta>
                    ) : (
                      <span className="text-[var(--color-muted)]">{fecha(i.expira_en)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <form action={revocarInvitacion}>
                      <input type="hidden" name="id" value={i.id} />
                      <Boton variante="discreto" type="submit" className="px-2 text-xs">
                        Revocar
                      </Boton>
                    </form>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </Tarjeta>
      )}
    </div>
  );
}
