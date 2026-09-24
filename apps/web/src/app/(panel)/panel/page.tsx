import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmbudoDelTenant } from '@/componentes/embudo.tsx';
import { Aviso, Boton, Etiqueta, Tarjeta, Vacio } from '@/componentes/ui/index.tsx';
import { baseDeDatos } from '@/lib/base-de-datos.ts';
import { sesionActual } from '@/lib/sesion.ts';

export const dynamic = 'force-dynamic';

/** Lo que devuelve `app.resumen_del_tenant`, en un solo viaje a la base. */
export interface Resumen {
  mes: string;
  embudo: { ingestados: number; cualificados: number; reuniones: number; cierres: number };
  coste: {
    gastado_eur: string;
    limite_eur: string;
    porcentaje: string | null;
    cortado: boolean;
    avisado_50: boolean;
    avisado_80: boolean;
    por_cualificado_eur: string | null;
    por_reunion_eur: string | null;
    por_cierre_eur: string | null;
  };
  maquinas: Record<string, number>;
  aprobaciones_pendientes: number;
  eventos_7_dias: number;
  archivos: number;
}

const euros = (valor: string | null): string =>
  valor === null ? '—' : `${Number(valor).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €`;

export default async function PaginaDeInicio() {
  const sesion = await sesionActual();
  if (sesion === undefined) redirect('/entrar');

  // Sin corporate, el panel es el asistente de creación. Es el caso T1.0 y no
  // un error: el sistema nace vacío.
  if (sesion.tenant === undefined) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">El sistema está vacío</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          No hay ningún corporate, ni un dato de negocio, ni un precio, ni un argumentario. Es como
          tiene que empezar: todo el conocimiento comercial entra por el onboarding de cada
          corporate y vive solo en su propio tenant.
        </p>
        <div className="mt-6">
          <Vacio
            titulo="Crea tu primer corporate"
            accion={
              <Link href="/panel/nuevo">
                <Boton data-testid="crear-primer-corporate">Crea tu primer corporate</Boton>
              </Link>
            }
          >
            Un corporate es una empresa con su equipo, sus archivos, sus credenciales y su
            presupuesto, aislados de cualquier otro.
          </Vacio>
        </div>
      </div>
    );
  }

  const tenant = sesion.tenant;
  const fila = await baseDeDatos().conRLS(sesion.usuario.id, (ctx) =>
    ctx.unaFila<{ resumen: Resumen }>('select app.resumen_del_tenant($1) as resumen', [tenant.id]),
  );

  if (fila === undefined) {
    return <Aviso tono="ko">No se ha podido leer el resumen de este corporate.</Aviso>;
  }

  const { embudo, coste, maquinas, aprobaciones_pendientes, eventos_7_dias, archivos } =
    fila.resumen;
  const limite = Number(coste.limite_eur);
  const porcentaje = coste.porcentaje === null ? 0 : Number(coste.porcentaje);

  const tarjetas = [
    {
      titulo: 'Gasto del mes',
      valor: euros(coste.gastado_eur),
      pie: `de ${euros(coste.limite_eur)}`,
    },
    {
      titulo: 'Coste por cualificado',
      valor: euros(coste.por_cualificado_eur),
      pie:
        embudo.cualificados === 0
          ? 'sin cualificados todavía'
          : `${String(embudo.cualificados)} este mes`,
    },
    {
      titulo: 'Coste por reunión',
      valor: euros(coste.por_reunion_eur),
      pie:
        embudo.reuniones === 0 ? 'sin reuniones todavía' : `${String(embudo.reuniones)} este mes`,
    },
    {
      titulo: 'Coste por cierre',
      valor: euros(coste.por_cierre_eur),
      pie: embudo.cierres === 0 ? 'sin cierres todavía' : `${String(embudo.cierres)} este mes`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.nombre}</h1>
        {tenant.esDemo && <Etiqueta tono="aviso">corporate de prueba</Etiqueta>}
      </div>

      {coste.cortado && (
        <Aviso tono="ko" titulo="Presupuesto del mes agotado">
          Este corporate ha llegado al 100 % de su presupuesto y las llamadas a modelo están
          bloqueadas.{' '}
          <Link href="/panel/ajustes" className="text-[var(--color-accent)] underline">
            Amplíalo en Ajustes
          </Link>
          .
        </Aviso>
      )}
      {!coste.cortado && coste.avisado_80 && (
        <Aviso tono="aviso" titulo="Has pasado el 80 % del presupuesto">
          Van {euros(coste.gastado_eur)} de {euros(coste.limite_eur)}.
        </Aviso>
      )}
      {!coste.cortado && !coste.avisado_80 && coste.avisado_50 && (
        <Aviso tono="aviso" titulo="Has pasado la mitad del presupuesto">
          Van {euros(coste.gastado_eur)} de {euros(coste.limite_eur)}.
        </Aviso>
      )}

      <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <div key={t.titulo} className="bg-[var(--color-ink-soft)] px-4 py-4">
            <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">{t.titulo}</p>
            <p className="mt-1.5 text-2xl font-semibold text-white">{t.valor}</p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">{t.pie}</p>
          </div>
        ))}
      </div>

      {limite > 0 && (
        <Tarjeta
          titulo="Presupuesto del mes"
          descripcion={`${porcentaje.toFixed(1)} % consumido. Avisos al 50 % y al 80 %, corte al 100 %.`}
        >
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-ink)]">
            <div
              data-testid="barra-presupuesto"
              className="h-full rounded-full transition-all"
              style={{
                width: `${String(Math.min(100, porcentaje))}%`,
                background:
                  porcentaje >= 100
                    ? 'var(--color-ko)'
                    : porcentaje >= 80
                      ? 'var(--color-warn)'
                      : 'var(--color-ok)',
              }}
            />
          </div>
        </Tarjeta>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tarjeta
            titulo="Embudo del mes"
            descripcion="Se cuenta sobre la tabla de eventos, que es la fuente de verdad del sistema: así las métricas no pueden discrepar de la auditoría."
          >
            <EmbudoDelTenant embudo={embudo} />
          </Tarjeta>
        </div>

        <div className="space-y-6">
          <Tarjeta titulo="Salud de las máquinas">
            {Object.keys(maquinas).length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                Todavía no hay ninguna máquina. Un buzón, una cuenta de LinkedIn o una línea de voz
                se conectan en F4, y el planificador que calcula cuántas hacen falta llega en F13.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {Object.entries(maquinas).map(([salud, n]) => (
                  <li key={salud} className="flex items-center justify-between">
                    <Etiqueta
                      tono={
                        salud === 'buena'
                          ? 'ok'
                          : salud === 'degradada'
                            ? 'aviso'
                            : salud === 'mala'
                              ? 'ko'
                              : 'neutro'
                      }
                    >
                      {salud}
                    </Etiqueta>
                    <span className="font-mono text-white">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo="Ahora mismo">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <Link
                  href="/panel/aprobaciones"
                  className="text-[var(--color-muted)] hover:text-white"
                >
                  Aprobaciones pendientes
                </Link>
                <span className="font-mono text-white" data-testid="aprobaciones-pendientes">
                  {aprobaciones_pendientes}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <Link href="/panel/eventos" className="text-[var(--color-muted)] hover:text-white">
                  Eventos en 7 días
                </Link>
                <span className="font-mono text-white">{eventos_7_dias}</span>
              </li>
              <li className="flex items-center justify-between">
                <Link href="/panel/archivos" className="text-[var(--color-muted)] hover:text-white">
                  Archivos de contexto
                </Link>
                <span className="font-mono text-white">{archivos}</span>
              </li>
            </ul>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
