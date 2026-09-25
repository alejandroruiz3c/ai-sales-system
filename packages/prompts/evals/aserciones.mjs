// Aserción `javascript` de promptfoo. La lógica, con tests, está en `evaluar.ts`.
import { CASOS } from './casos.ts';
import { evaluarClasificacion, evaluarEmail } from './evaluar.ts';

export function comprobar(salida, contexto) {
  const vars = contexto?.vars ?? {};
  const caso = (CASOS[vars.plantilla] ?? []).find((c) => c.id === vars.caso);
  if (caso === undefined)
    return { pass: false, score: 0, reason: `Caso desconocido: ${vars.caso}` };
  if (vars.plantilla === 'clasificar-respuesta')
    return evaluarClasificacion(salida, caso, vars.hoy);
  if (vars.plantilla === 'redactar-email') return evaluarEmail(salida, caso);
  return { pass: false, score: 0, reason: `Plantilla sin evaluador: ${vars.plantilla}` };
}
