'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * El embudo del corporate.
 *
 * En F1 está a cero, y eso es información, no un fallo: los cuatro eventos que
 * cuenta (`prospect.ingested`, `prospect.qualified`, `meeting.booked`,
 * `deal.won`) empiezan a existir en F5 y después. Así que cuando todo vale cero
 * se dice con palabras y no se pinta un gráfico plano, que se lee como un error
 * de carga.
 */
export function EmbudoDelTenant({
  embudo,
}: {
  embudo: { ingestados: number; cualificados: number; reuniones: number; cierres: number };
}) {
  const datos = [
    { etapa: 'Ingestados', valor: embudo.ingestados },
    { etapa: 'Cualificados', valor: embudo.cualificados },
    { etapa: 'Reuniones', valor: embudo.reuniones },
    { etapa: 'Cierres', valor: embudo.cierres },
  ];

  const total = datos.reduce((suma, d) => suma + d.valor, 0);

  if (total === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-muted)]">
          El embudo está a cero porque todavía no ha entrado ningún prospecto. Los cuatro contadores
          se llenan solos a partir de F5, cuando la prospección empiece a publicar sus eventos; no
          hay nada que configurar aquí.
        </p>
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
          {datos.map((d) => (
            <li key={d.etapa} className="bg-[var(--color-ink)] px-3 py-3 text-center">
              <span className="block text-xs text-[var(--color-muted)]">{d.etapa}</span>
              <span className="mt-1 block font-mono text-lg text-white">0</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="h-64" data-testid="embudo">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" stroke="#8b97a8" fontSize={12} allowDecimals={false} />
          <YAxis type="category" dataKey="etapa" stroke="#8b97a8" fontSize={12} width={96} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-ink-soft)',
              border: '1px solid var(--color-line)',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          {/*
            Un solo color para las cuatro barras, y no uno por etapa. El color
            debería codificar un dato, y aquí la etapa ya está en el eje: darle
            además un color propio a cada barra no añade información y hace que
            el gráfico se lea como cuatro series distintas cuando es una.
          */}
          <Bar dataKey="valor" name="Prospectos" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
