# ADR 0002 · Stack tecnológico

- **Estado:** Aceptado
- **Fecha:** 2026-09-16 · **Aceptado:** 2026-09-18
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.12

---

## Contexto

SALES OS tiene que sostener tres cosas a la vez que normalmente se eligen por
separado: un panel web multi-tenant, procesos de larga duración con reintentos, y
navegadores persistentes con IP fija. Además lo van a tocar en paralelo Claude
Code y equipos externos, así que el stack tiene que ser aprendible: cada
tecnología añadida es un proveedor más que administrar, una factura más y un
concepto más que explicar a quien entra nuevo.

## Decisión

Un solo lenguaje, un solo repo, el menor número de proveedores posible.

| Capa           | Elección                                        | Por qué esta y no otra                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lenguaje       | **TypeScript estricto**                         | Mismo lenguaje del panel al worker; los tipos de los eventos son compartidos de verdad, no copiados. El sistema antiguo era Python y su valor son las reglas, no el código (ADR 0001).                                                                                  |
| Monorepo       | **pnpm workspaces + Turborepo**                 | Un repo con paquetes por agente permite que un equipo externo trabaje en su agente sin conocer la infraestructura. Turborepo da builds cacheados en CI.                                                                                                                 |
| Frontend y API | **Next.js (App Router) en Vercel**              | Vercel es el destino de despliegue fijado por dirección. Previews por PR sin montar nada.                                                                                                                                                                               |
| UI             | **Tailwind + shadcn/ui**                        | Componentes que se copian al repo en vez de una dependencia que dicta el diseño. Coste cero.                                                                                                                                                                            |
| Base de datos  | **Supabase Postgres (UE) con RLS**              | El aislamiento entre tenants se hace en la base, no en el código (ADR 0003). Auth, Storage y Vault en el mismo proveedor: tres problemas resueltos sin tres facturas.                                                                                                   |
| ORM            | **Drizzle + migraciones versionadas**           | Tipado real y migraciones en Git. Un ORM que esconde el SQL es un problema cuando hay que razonar sobre políticas RLS.                                                                                                                                                  |
| Orquestación   | **Inngest**                                     | Workflows durables con reintentos, `step.sleep` de días, `cancelOn` y claves de concurrencia y throttle por tenant y por máquina. Los límites de canal se cumplen por diseño y no por disciplina, que es exactamente donde falló el sistema antiguo (colas en memoria). |
| Validación     | **Zod**                                         | Un único lenguaje de esquema para eventos, configuración y salidas de LLM.                                                                                                                                                                                              |
| LLM            | **API de Anthropic detrás de un router propio** | El router (`packages/llm`) permite enrutar por coste, cachear el bloque fijo del perfil comercial, usar lotes y contabilizar por tenant. Sin router, el coste no es observable ni limitable.                                                                            |
| Voz            | **Plataforma de agentes de voz + Twilio**       | ADR 0005.                                                                                                                                                                                                                                                               |
| Firma          | **Docuseal o Signaturit**                       | ADR 0006.                                                                                                                                                                                                                                                               |
| Observabilidad | **Langfuse (UE) + Sentry + Better Stack**       | Langfuse responde "cuánto nos cuesta cada reunión agendada", que Sentry no sabe; Sentry responde "qué se ha roto", que Langfuse no sabe.                                                                                                                                |
| Evals          | **promptfoo en CI**                             | Los prompts son código: un PR que baja la calidad de un agente no se fusiona.                                                                                                                                                                                           |
| Tests          | **Vitest + Playwright Test**                    | Vitest para reglas y agentes; Playwright para los kits de prueba de fase contra staging.                                                                                                                                                                                |
| Workers        | **Node + Playwright en Docker sobre Hetzner**   | ADR 0004.                                                                                                                                                                                                                                                               |

## Consecuencias

**A favor**

- Una persona que sepa TypeScript puede contribuir a cualquier parte.
- Supabase concentra base de datos, auth, storage y secretos: menos superficie que administrar y una sola región UE que justificar.
- Inngest hace que la durabilidad sea el comportamiento por defecto en vez de algo que hay que recordar implementar.

**En contra, y asumido**

- **Dependencia de Vercel y de Supabase.** Mitigación: la lógica de los agentes no conoce su runtime (`packages/agents/*` sin imports de Next), y la base es Postgres estándar, así que un traslado sería doloroso pero no una reescritura.
- **Inngest es un proveedor más en la ruta crítica.** Si Inngest cae, el sistema deja de mover prospectos. Se acepta a cambio de no construir un orquestador propio, que es la alternativa realista y peor.
- **Nada del código Python se reutiliza literalmente.** Coste asumido en el ADR 0001.
- **El stack tiene 20 piezas.** Es mucho, y es el mínimo para lo que el plan pide. Cada pieza nueva a partir de aquí necesita su propio ADR.

## Alternativas consideradas

1. **Python en los workers y TypeScript en el panel.** Rechazada: duplica los tipos de eventos y parte el equipo en dos. La tentación venía de reutilizar el código antiguo, y el ADR 0001 concluye que lo aprovechable son las reglas.
2. **Temporal en vez de Inngest.** Más potente y sensiblemente más operación (cluster propio o Temporal Cloud). Inngest cubre lo que el plan necesita y habla con Vercel sin intermediarios. Si algún día hacen falta workflows de meses con versionado complejo, se revisa.
3. **Postgres propio en Hetzner en vez de Supabase.** Más barato y más trabajo: auth, storage, backups y cifrado de secretos habría que montarlos. Se descarta mientras Supabase cubra la región UE.
4. **Prisma en vez de Drizzle.** Prisma esconde el SQL y eso choca con razonar sobre políticas RLS, que es la parte que no se puede permitir aproximar.
5. **Todo en Vercel, sin Hetzner.** Técnicamente inviable para LinkedIn. Ver ADR 0004 y riesgo 7 del plan.

## Decisión de Alex (2026-09-18)

**Aceptado.** Con tres precisiones que pasan a ser vinculantes:

1. **Región UE, concretada.** Vercel en `fra1` (Fráncfort) y Supabase en
   Fráncfort, los dos proyectos. _(La región de Supabase la sustituye el
   [ADR 0010](0010-region-de-supabase-staging-irlanda.md): staging está en
   Irlanda.)_ Ninguna función, base de datos ni cola sale de
   la UE. Cualquier proveedor nuevo que no pueda garantizar región UE necesita
   un ADR propio antes de entrar.
2. **Inngest se acepta en la ruta crítica**, porque sin durabilidad no hay
   sistema: una secuencia de outreach que se pierde a medias es peor que una que
   no arranca.
3. **Y por eso lleva mitigación obligatoria**, que es la parte que convierte la
   aceptación en algo defendible:
   - **Todos los eventos se persisten en la tabla `events`** antes de enviarse a
     Inngest. La tabla es la fuente de verdad, no la cola: si Inngest pierde un
     evento, el evento sigue existiendo.
   - **Hay procedimiento de reproceso escrito** en
     [`docs/runbooks/reproceso-de-eventos.md`](../runbooks/reproceso-de-eventos.md),
     con cómo detectar el hueco, cómo reinyectar y cómo evitar duplicados.
   - Las dos cosas se implementan en F1 (modelo de datos y bus de eventos) y son
     condición para cerrar la fase, no un extra.

Si en el futuro Inngest deja de encajar, con la tabla `events` como fuente de
verdad el cambio de orquestador es un trabajo acotado, no una reescritura.

---

## Aviso 2026-09-24 · la región UE de los logs sigue abierta, y vence antes de F5

Este ADR dice que **ninguna función, base de datos ni cola sale de la UE**, y hoy
hay una pieza que sí: **Better Stack sirve la única región disponible para esta
cuenta, `us_west`** (Oregón). Está documentado en el informe de entrega de F0,
apartado 7.1, con la respuesta literal de su API.

No se reescribe la decisión —los ADR no se reescriben a posteriori—, se le pone
**plazo y condición de cierre**:

**La decisión de dónde viven los logs tiene que estar RESUELTA ANTES DE EMPEZAR
F5.** No antes de F14.5, como decía el informe de F0: antes de F5.

El motivo del adelanto es que **F5 es la primera fase que procesa datos
personales de terceros**. Hasta F4 el sistema trata configuración, credenciales
del propio tenant y datos técnicos. En F5 entran nombre, cargo, email, teléfono
y perfil de LinkedIn de personas que no son clientes nuestros ni han firmado
nada con nosotros, y esos datos acaban en trazas de ejecución. Sacarlos de la UE
sin base legal ni evaluación de transferencia internacional no es una deuda
técnica: es un tratamiento que no deberíamos haber hecho, y que no se arregla
cambiando de proveedor después, porque los logs ya salieron.

Las tres salidas posibles siguen siendo las del informe de F0, sin orden de
preferencia impuesto:

| Salida                         | Qué hay que comprobar antes de elegirla                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Better Stack con región UE** | Que su soporte confirme por escrito que `germany` se habilita para esta cuenta, y en qué plan             |
| **Otro proveedor SaaS con UE** | Región UE contratable y verificable. El logger ya está detrás de una interfaz: el cambio es de un fichero |
| **Autoalojado en Hetzner**     | Ya hay servidores UE por el ADR 0004. Sin licencia y sin proveedor nuevo, a cambio de operarlo nosotros   |

Alex escribió al soporte de Better Stack el 2026-09-24 preguntando por la región
UE. Mientras no haya respuesta y decisión, el estado es este:

- Los logs siguen yendo a `ai-sales-staging` en `us-west-2a`, y **solo llevan
  datos técnicos**: el logger de `packages/core/src/log.ts` redacta emails,
  teléfonos, documentos y perfiles de LinkedIn antes de emitir.
- **No se crea la fuente de producción en EE. UU.**, porque fijaría justo lo que
  este ADR prohíbe.
- Cuando se decida, se escribe un **ADR nuevo** que sustituya la fila de
  observabilidad de la tabla de decisión. Si la salida elegida es un proveedor
  distinto de los tres nombrados, ese ADR es obligatorio antes de conectarlo,
  por la precisión 1 de la decisión de Alex.

Seguimiento: [issue #220](https://github.com/alejandroruiz3c/ai-sales-system/issues/220), etiquetada `bloqueado` y
`seguridad`, y anotada como condición de entrada de F5 en el plan (§F5) y en
`scripts/backlog.json`.
