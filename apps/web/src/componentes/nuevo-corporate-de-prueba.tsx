'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Aviso, Boton, Campo, Entrada } from './ui/index.tsx';

/**
 * Crea un corporate de prueba con presupuesto desde `/lab`, para el probador
 * de modelos. Nace sin miembros: solo se ve aquí, y el reset lo borra.
 */
export function NuevoCorporateDePrueba() {
  const router = useRouter();
  const [nombre, setNombre] = useState('Corporate Modelos Demo');
  const [presupuesto, setPresupuesto] = useState('5');
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'ko'; texto: string } | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  async function crear(): Promise<void> {
    setEnCurso(true);
    setMensaje(null);
    try {
      const respuesta = await fetch('/api/lab/corporate-de-prueba', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nombre, presupuestoEur: Number(presupuesto) }),
      });
      const json = (await respuesta.json()) as { error?: string; nombre?: string };
      if (json.error !== undefined) setMensaje({ tono: 'ko', texto: json.error });
      else {
        setMensaje({ tono: 'ok', texto: `Creado «${json.nombre ?? nombre}».` });
        router.refresh();
      }
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-64">
        <Campo etiqueta="Nombre del corporate de prueba">
          <Entrada
            data-testid="nuevo-corporate-nombre"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
            }}
          />
        </Campo>
      </div>
      <div className="w-32">
        <Campo etiqueta="Presupuesto (€)">
          <Entrada
            data-testid="nuevo-corporate-presupuesto"
            type="number"
            min={0}
            max={50}
            step="0.5"
            value={presupuesto}
            onChange={(e) => {
              setPresupuesto(e.target.value);
            }}
          />
        </Campo>
      </div>
      <Boton variante="secundario" disabled={enCurso} onClick={() => void crear()}>
        Crear corporate de prueba
      </Boton>
      {mensaje !== null && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}
    </div>
  );
}
