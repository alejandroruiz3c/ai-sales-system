# Agente de prueba

- **Clave:** `prueba`
- **Paquete:** `packages/agents/prueba`
- **Fase:** F1
- **Estado:** operativo

---

## 1. Qué hace

Genera una acción inofensiva —un texto sin un solo dato de negocio— y decide si
la envía según su nivel de autonomía. No escribe a nadie, no llama a ningún
modelo y no toca ningún prospecto.

Existe por un motivo concreto: **los casos T1.7, T1.8 y T1.9 del kit necesitan
un agente que no sea ninguno de los reales**. Probar el nivel de autonomía con
el agente de emailing significaría que un fallo del kit puede mandar un correo
de verdad, y probar el corte de presupuesto con él significaría gastar dinero
para comprobar que el corte funciona.

Se usa desde la sala de pruebas (`/lab`) y es el agente con el que se estrena
cualquier mecanismo transversal: aprobaciones, presupuesto, niveles, y en
adelante el Estudio y el Copiloto.

## 2. Qué configura

Su esquema vive en `esquemaConfigDePrueba` y se edita desde
`/panel/configuracion`, con historial y reversión como cualquier otro agente.

| Campo            | Qué decide                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| `nivelAutonomia` | Si la acción se queda en el cajón, pide aprobación o sale sola (L0–L3)  |
| `tono`           | Con qué frase se redacta. Cambia el texto de forma visible, para T1.5   |
| `limiteDiario`   | Cuántas acciones puede enviar al día cuando va solo (solo aplica en L2) |

Todavía **no tiene prompts por bloques**: no llama a ningún modelo. Cuando el
Estudio exista (F2B) y el router de modelos también (F2), este agente será el
primero en tenerlos, porque es el único con el que se puede equivocar uno sin
consecuencias.

## 3. Qué eventos emite

| Evento                     | Cuándo                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `prueba.accion.generada`   | **Siempre** que se ejecuta, haya salido la acción o no                   |
| `approval.requested`       | En nivel L1, al dejar la aprobación en la cola                           |
| `prueba.accion.enviada`    | Solo cuando la acción sale de verdad: en L2 y L3, o al aprobar una de L1 |
| `budget.threshold.reached` | Lo emite el presupuesto al cruzar el 50 %, el 80 % o el 100 %            |

Que `prueba.accion.generada` se emita siempre es deliberado: sin él, un agente
en L0 parecería no haber hecho nada, cuando lo que ha hecho es generar y
contenerse. Esa distinción es exactamente lo que el caso T1.9 comprueba.

No consume eventos: lo dispara una persona desde `/lab`. A partir de F6 se le
podrá suscribir a algo si hace falta probar una cadena completa.

## 4. Límites

- **Coste fijo de 0,05 € por ejecución.** No es un número al azar: con un
  presupuesto de 0,50 €, la quinta llamada cruza el 50 %, la octava el 80 % y la
  décima agota. Los tres umbrales caen en llamadas distintas y exactas, así que
  el caso T1.8 es aritmética y no una estimación.
- **El presupuesto manda sobre el nivel.** Si el corporate ha agotado el mes, el
  agente no se ejecuta aunque esté en L3. El orden importa: primero el dinero,
  después la autonomía.
- **Solo actúa sobre corporates marcados de prueba.** La sala de pruebas se
  entra con una contraseña de plataforma, no con una sesión de tenant, así que
  la frontera es esa marca y se comprueba en cada llamada.
- **En L2, el límite diario se cuenta sobre los eventos del día**, no sobre un
  contador en memoria: dos ejecuciones simultáneas no se lo pueden saltar.

## 5. Métricas

Ninguna de calidad: no hay nada que juzgar en un texto fijo. Lo que sí se mira
de él es lo que prueba de los demás:

- que el gasto acumulado del corporate cuadre con el número de ejecuciones;
- que el número de aprobaciones pendientes coincida con las ejecuciones en L1;
- que no exista ni un `prueba.accion.enviada` en un corporate cuyo agente esté
  en L0.

## 6. Problemas frecuentes

| Síntoma                                         | Causa                                                                    | Cómo se comprueba                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| «He pulsado y no ha pasado nada»                | Nivel L0: genera y no envía. Es el comportamiento correcto               | El resultado de `/lab` dice `solo-generar` con su motivo, y queda el evento `prueba.accion.generada` |
| «No se ejecuta y no dice por qué»               | Presupuesto del mes agotado                                              | El resultado dice `presupuesto_agotado`; el panel de inicio lo avisa en rojo                         |
| «Dice que no tiene presupuesto y sí lo tiene»   | El límite del mes está a cero, que no es lo mismo que agotado            | `app.cobrar_llamada` distingue `sin_presupuesto` de `presupuesto_agotado`                            |
| «El corporate no aparece en la sala de pruebas» | No está marcado como de prueba                                           | `/lab` solo lista los `es_demo`; se marca al crearlo                                                 |
| «En L2 ha dejado de enviar a media mañana»      | Límite diario alcanzado. **No pide aprobación en su lugar**, a propósito | El motivo lo dice; se reanuda al día siguiente                                                       |

La última fila es una decisión y conviene que quede escrita: convertir un tope
en una petición de permiso lo transformaría en una molestia que alguien acabaría
aprobando por costumbre, y entonces el tope no sería un tope.
