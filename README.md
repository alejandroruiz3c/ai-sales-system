# SALES OS

Plataforma de ventas agéntica multi-corporate, desarrollada por TurbineH.

**SALES OS nace vacío.** No trae ningún corporate, producto, precio, ICP,
argumentario ni modelo de negocio precargado, tampoco el de TurbineH, que solo
aporta el dominio, el repositorio y la marca de la plataforma. Todo el
conocimiento comercial entra por el onboarding de cada corporate y vive en la
base de datos de su tenant. Lo comprueba `pnpm sistema-vacio` en cada PR.

Cada corporate es un tenant aislado que, a partir de tres inputs (deck, web y
argumentario), obtiene su propio sistema de ventas completo: prospección,
cualificación, outreach multicanal coordinado, cierre, facturación, upsell y
generación de opinión.

- **Plan de dirección técnica:** [`docs/plan-sales-os.md`](docs/plan-sales-os.md)
- **Reglas para Claude Code y para cualquier IA colaboradora:** [`CLAUDE.md`](CLAUDE.md)
- **Cómo contribuir:** [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Decisiones de arquitectura:** [`docs/adr/`](docs/adr/)
- **Informes de entrega por fase:** [`docs/entregas/`](docs/entregas/)

## Arranque rápido

```bash
pnpm install
cp .env.example .env.local   # pide las claves a Alex; nunca las comitees
pnpm dev                     # panel en http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test
```

## Estructura

```
apps/web              Panel Next.js, API, webhooks y funciones Inngest (Vercel)
apps/worker-browser   Playwright: LinkedIn y opinión en navegador (Hetzner)
packages/core         Tipos, eventos Zod, máquina de estados, errores, reglas
packages/db           Esquema Drizzle, migraciones, políticas RLS, seeds
packages/llm          Router de modelos, caché, batch, contabilidad de coste
packages/prompts      Plantillas versionadas por agente + evals
packages/agents/*     Lógica de cada agente, independiente del runtime
packages/studio       Registro de agentes, capas de configuración, versionado
packages/integrations Adaptadores externos + interceptor de modo sandbox
packages/capacity     Planificador de capacidad y coste
packages/config       ESLint, TypeScript y Tailwind compartidos
infra/                Hetzner (Docker) y Supabase
```

## Estado

Estado documental actualizado el 26 de septiembre de 2026, contrastado con los
informes de entrega y el código de `main`:

| Fase                         | Estado documentado                                                      |
| ---------------------------- | ----------------------------------------------------------------------- |
| F0 · Fundaciones y auditoría | Entrega disponible en [F0](docs/entregas/F0.md)                         |
| F1 · Núcleo multi-tenant     | Entrega disponible en [F1](docs/entregas/F1.md)                         |
| F2 · Librería LLM y prompts  | Entregada; validación de Alex pendiente según [F2](docs/entregas/F2.md) |
| F2B y posteriores            | No se inician sin la aprobación de fase correspondiente                 |

Los informes contienen resultados históricos de pruebas, no una certificación de
la revisión actual. Las últimas ejecuciones de GitHub Actions consultadas el
26 de septiembre terminan en `startup_failure`; verificar también el check de
Vercel y el resultado local de `pnpm verify` antes de fusionar.

### Implementación y estructura reservada

El núcleo de datos, router LLM, plantillas y agente de prueba tienen implementación.
`packages/studio`, `packages/capacity`, los diez agentes comerciales y
`apps/worker-browser` contienen estructura reservada para fases posteriores.
La existencia de un paquete y su test de manifiesto no significa que el agente
esté implementado. Consultar el plan y los informes antes de anunciar capacidades.

Ninguna fase empieza sin el `GO FX` de Alex. Ver [AGENTS.md](AGENTS.md).
