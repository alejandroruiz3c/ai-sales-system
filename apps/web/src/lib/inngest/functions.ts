import { recordEvent } from '../events.ts';
import { helloRequested, inngest } from './client.ts';

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

export const functions = [helloFunction];
