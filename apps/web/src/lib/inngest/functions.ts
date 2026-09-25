import { recordEvent } from '../events.ts';
import { recogerLoteT24 } from '../lab-modelos.ts';
import { helloRequested, inngest, loteLlmEnviado } from './client.ts';

/**
 * Función de humo de F0.10: demuestra que un evento sale del panel, Inngest lo
 * recoge, ejecuta un paso durable y el resultado vuelve al visor de `/lab`.
 */
export const helloFunction = inngest.createFunction(
  {
    id: 'hello',
    name: 'Hello de F0',
    triggers: [helloRequested],
    // Una ejecución por tenant a la vez. Es el patrón que usarán todas las
    // funciones del sistema y conviene que esté aquí desde el primer día: así
    // un tenant no consume nunca la capacidad de otro.
    concurrency: [{ key: 'event.data.tenantId', limit: 1 }],
  },
  async ({ event, step }) => {
    const greeting = await step.run(
      'saludar',
      () => `Hola desde Inngest · tenant ${event.data.tenantId}`,
    );

    await step.run('registrar-en-el-visor', () => {
      recordEvent({
        kind: 'inngest',
        name: 'sales-os/hello.completed.v1',
        tenantId: event.data.tenantId,
        agent: 'sistema',
        message: greeting,
        data: { requestedBy: event.data.requestedBy },
      });
      return true;
    });

    return { greeting };
  },
);

/**
 * Espera entre consultas a un lote: rápido al principio, porque un lote
 * pequeño suele terminar en uno o dos minutos, y cada cinco minutos después.
 * Con 400 consultas cubre de sobra las 24 horas que la Batch API da de plazo,
 * por debajo del límite de pasos de Inngest.
 */
function esperaDeLote(consulta: number): string {
  if (consulta < 6) return '20s';
  if (consulta < 20) return '1m';
  return '5m';
}

const CONSULTAS_MAXIMAS_DE_LOTE = 400;

/**
 * F2.3 · recoge un lote de la Batch API cuando termina.
 *
 * Cada consulta es un paso: si la función se reinicia a mitad, no vuelve a
 * consultar lo ya consultado, y el paso que encuentra el lote terminado lo
 * recoge, lo liquida en el presupuesto y lo anota en `events` de una vez.
 */
export const recogerLoteLlm = inngest.createFunction(
  {
    id: 'recoger-lote-llm',
    name: 'Recoger lote de modelos (F2.3)',
    triggers: [loteLlmEnviado],
    concurrency: [{ key: 'event.data.tenantId', limit: 2 }],
    retries: 3,
  },
  async ({ event, step }) => {
    for (let consulta = 0; consulta < CONSULTAS_MAXIMAS_DE_LOTE; consulta++) {
      const { terminado } = await step.run(`consultar-${String(consulta)}`, () =>
        recogerLoteT24(event.data),
      );
      if (terminado) return { terminado: true, consultas: consulta + 1 };
      await step.sleep(`esperar-${String(consulta)}`, esperaDeLote(consulta));
    }
    throw new Error(
      `El lote ${event.data.loteId} no ha terminado tras ${String(CONSULTAS_MAXIMAS_DE_LOTE)} consultas.`,
    );
  },
);

export const functions = [helloFunction, recogerLoteLlm];
