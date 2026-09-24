/**
 * Qué agentes se pueden configurar desde el panel, hoy.
 *
 * **Esto es provisional y se sabe.** El registro de verdad es `packages/studio`
 * (F2B.2), donde cada agente declara su esquema, sus prompts por bloques y su
 * ficha, y el Estudio genera el formulario a partir de ahí (F2B.3). Mientras
 * eso no existe, esta lista es lo que permite que F1 entregue la capa de
 * configuración versionada con algo real dentro.
 *
 * Hay dos entradas y las dos hacen falta:
 *
 *   · **`prueba`** es el agente ficticio del kit. Es el que se toca en T1.7,
 *     T1.8 y T1.9, porque probar el nivel de autonomía con un agente real
 *     significaría que un fallo del kit puede mandar un correo de verdad;
 *   · **`emailing`** existe porque el caso T1.5 dice literalmente «cambias el
 *     tono del agente de emailing a cercano, guardas, y después reviertes». El
 *     agente llega en F7; lo que F1 entrega es que su configuración se pueda
 *     guardar, versionar y revertir antes de que exista quien la lea. Ese orden
 *     es el correcto: un agente que llega y no se puede configurar no está
 *     terminado (Definición de Hecho, F2B).
 */

import { CONFIG_POR_DEFECTO, FICHA } from '@sales-os/agent-prueba';
import { configDeAgentePorDefecto, type ConfigDeAgente } from '@sales-os/db';

export interface AgenteDelPanel {
  readonly clave: string;
  readonly nombre: string;
  readonly resumen: string;
  /** Qué fase lo implementa de verdad. En F1 solo existe su configuración. */
  readonly fase: string;
  readonly configInicial: ConfigDeAgente;
}

export const AGENTES_DEL_PANEL: readonly AgenteDelPanel[] = [
  {
    clave: FICHA.clave,
    nombre: FICHA.nombre,
    resumen: FICHA.resumen,
    fase: 'F1',
    configInicial: {
      ...configDeAgentePorDefecto(
        'Generar una acción de prueba inofensiva para comprobar aprobaciones, presupuesto y nivel de autonomía',
      ),
      limites: { porDia: CONFIG_POR_DEFECTO.limiteDiario, porSemana: 0 },
      especifico: { tono: CONFIG_POR_DEFECTO.tono, limiteDiario: CONFIG_POR_DEFECTO.limiteDiario },
    },
  },
  {
    clave: 'emailing',
    nombre: 'Agente de emailing',
    resumen:
      'Redacta y envía los correos de la secuencia de outreach. Aquí solo se configura: el agente llega en F7 y leerá esta misma configuración.',
    fase: 'F7',
    configInicial: configDeAgentePorDefecto(
      'Redactar y enviar los correos de la secuencia según el perfil comercial del corporate',
    ),
  },
];

export function agentePorClave(clave: string): AgenteDelPanel | undefined {
  return AGENTES_DEL_PANEL.find((a) => a.clave === clave);
}
