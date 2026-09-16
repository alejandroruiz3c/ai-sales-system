import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client.ts';
import { functions } from '@/lib/inngest/functions.ts';

/**
 * Punto de entrada de Inngest (F0.10).
 *
 * `GET` sirve la introspección (qué funciones hay y si la clave de firma es
 * válida), que es lo que comprueba `/status`. `PUT` registra las funciones y
 * `POST` las ejecuta.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
