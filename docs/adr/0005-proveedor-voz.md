# ADR 0005 · Proveedor de la plataforma de voz

- **Estado:** Propuesto
- **Fecha:** 2026-09-16
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.12 · se implementa en F9.1

---

## Contexto

El agente de llamadas (F9) tiene que sostener una conversación en español
natural, con turnos sin silencios incómodos, adaptarse a lo que dice el
prospecto, consultar disponibilidad y **agendar una reunión durante la llamada**,
detectar intención de cierre y avisar a un humano al instante.

El plan deja la elección abierta entre **Retell** y **Vapi**, ambos sobre Twilio
para los números, y la remite a este ADR.

Lo que hace que esto se decida bien o mal no es el precio por minuto: es la
latencia en español y la fiabilidad de las llamadas a herramientas en mitad de
una conversación. Un agente que tarda dos segundos en responder pierde la
llamada; uno que no consigue leer el calendario no agenda.

## Decisión propuesta

**Retell como proveedor principal, detrás de una interfaz `VoiceAdapter`, con
Vapi implementado como segundo adaptador si la prueba de campo lo desaconseja.**

El peso de la decisión no está en el proveedor: está en que **el proveedor sea
sustituible**. Por eso lo que se decide de verdad aquí es la interfaz:

```
VoiceAdapter
  createAgent(config)          guion, voz, idioma, aviso de IA
  placeCall(to, context)       con el contexto del prospecto
  registerTools(tools)         consultar disponibilidad, agendar, marcar cierre
  onWebhook(event)             inicio, fin, transcripción, grabación, resultado
  getRecording(callId)
  getTranscript(callId)
```

Con esa interfaz, cambiar de proveedor en F9 es escribir un adaptador y pasar los
mismos tests de contrato, no reescribir el agente.

**Retell primero** por tres razones, en este orden:

1. Está orientado a agentes de llamada telefónica de principio a fin (números,
   webhooks de ciclo de vida, grabación y transcripción incluidos), que es
   exactamente el caso de F9, en vez de ser un framework general de voz.
2. Su modelo de function calling en llamada es el que mejor encaja con F9.6
   (consultar huecos y agendar en directo).
3. Integración con Twilio para traer números propios, que es lo que el plan pide
   para gestionar líneas como "máquinas" con límites y rotación (F9.2).

**Twilio** en ambos casos para los números, la rotación y la identificación de
llamante.

## Criterios de la prueba de campo (obligatoria antes de aceptar este ADR)

La decisión no se cierra por documentación. Antes de pasar a "Aceptado" hay que
ejecutar con los dos proveedores la misma batería, que es el kit de F9:

| Criterio                                      | Cómo se mide                                       | Umbral                                                            |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| Latencia de turno en español                  | Medición sobre 10 llamadas reales al móvil de Alex | Sin silencios percibidos; rúbrica de F9 ≥ 4/5                     |
| Naturalidad de la voz en español de España    | Rúbrica de F9, valoración de Alex                  | ≥ 4/5                                                             |
| Interrupciones (el prospecto corta al agente) | 5 llamadas cortando a media frase                  | El agente cede el turno y retoma                                  |
| Herramienta en llamada                        | T9.1: agendar durante la llamada                   | Reunión creada en el calendario en la propia llamada              |
| Detección de cierre                           | T9.3                                               | Evento `deal.close_intent` con resumen en menos de 1 minuto       |
| Aviso de IA                                   | T9.4 y F9.5                                        | Aviso presente en el 100 % de las llamadas, configurable por país |
| Contestador y número erróneo                  | T9.6                                               | Resultado clasificado y reintento programado                      |
| Coste real por minuto                         | Factura de la prueba                               | Dentro del objetivo que fije Alex                                 |

Los precios y los límites vigentes de ambos proveedores se verifican en **F13.1**
junto al resto; las cifras que circulan hoy no se dan por buenas en este ADR.

## Consecuencias

**A favor**

- La decisión cara (la interfaz) se toma ahora; la barata (el proveedor) se toma
  con datos reales en F9.
- Si el proveedor sube precios, cambia condiciones o degrada el español, el
  cambio cuesta un adaptador.

**En contra, y asumido**

- Escribir el adaptador es trabajo extra frente a llamar al SDK directamente.
  Se acepta: la voz es la parte del sistema con más riesgo de proveedor.
- Probar dos proveedores cuesta tiempo en F9. Es más barato que descubrir en
  producción que el español suena a robot.

**Obligaciones legales que no dependen del proveedor** (plan §7, riesgo 3): aviso
de que se habla con una IA, respeto de la lista Robinson, horarios permitidos y
número identificable. Se implementan en el agente, no en el proveedor, para que
cambiar de proveedor no las ponga en riesgo. La configuración legal por país la
valida un abogado antes de activar el canal.

## Alternativas consideradas

1. **Vapi.** Más flexible como framework y con más piezas que configurar. Queda
   como segundo adaptador y como candidato si gana la prueba de campo.
2. **Construirlo con Twilio Media Streams + STT + TTS propios.** Control total y
   un problema de ingeniería de latencia en tiempo real que no es el negocio de
   TurbineH. Rechazada.
3. **ElevenLabs Agents.** Excelente voz; hay que verificar en la prueba de campo
   la gestión del ciclo de llamada telefónica y las herramientas en llamada. Se
   incluye en la batería como tercer candidato si Alex quiere.

## Pendiente de decisión de Alex

- Aprobar que la decisión final se tome tras la prueba de campo de F9, no ahora.
- Fijar el objetivo de coste por minuto y por reunión agendada.
- Confirmar quién valida la configuración legal por país (asesor legal).
