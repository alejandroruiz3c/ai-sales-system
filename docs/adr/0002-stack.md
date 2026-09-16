# ADR 0002 · Stack tecnológico

- **Estado:** Propuesto
- **Fecha:** 2026-09-16
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

## Pendiente de decisión de Alex

- Confirmar Vercel y Supabase como proveedores con compromiso de región UE.
- Confirmar que se acepta Inngest en la ruta crítica.
