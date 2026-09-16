# Cómo contribuir a SALES OS

Bienvenido. Este repositorio lo trabajan en paralelo Claude Code y equipos
externos, cada uno sobre uno o dos agentes. Las reglas de abajo existen para que
eso no acabe en un choque.

Antes de nada, lee [`CLAUDE.md`](CLAUDE.md). Es corto y es obligatorio: fija las
reglas permanentes (TypeScript estricto, nada sin test, nada sin `tenant_id`,
secretos solo en Vault, eventos con Zod, prompts en dos capas). Este documento
explica el _cómo_; `CLAUDE.md` explica el _qué no se rompe_.

## 1. Poner el entorno en marcha

```bash
# Node 22 o superior y pnpm 10
corepack enable
pnpm install

# Variables: pide las claves a Alex. Nunca comitees .env.local
cp .env.example .env.local

pnpm dev          # panel en http://localhost:3000
```

Comprobaciones antes de abrir un PR:

```bash
pnpm lint         # ESLint en todo el monorepo, cero warnings
pnpm typecheck    # tsc --noEmit en cada paquete
pnpm test         # Vitest en cada paquete
pnpm build        # build de producción
```

Los cuatro tienen que estar en verde. CI ejecuta exactamente los mismos.

## 2. Dónde va cada cosa

| Si estás tocando…                                                | Va en…                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| La lógica de un agente                                           | `packages/agents/<agente>/` — sin dependencias del runtime |
| Un contrato de evento, un tipo compartido, una regla transversal | `packages/core/`                                           |
| Esquema, migración o política RLS                                | `packages/db/`                                             |
| Una llamada a un modelo                                          | `packages/llm/` — nunca el SDK de Anthropic directo        |
| El texto de un prompt base                                       | `packages/prompts/` — con su eval                          |
| Un servicio externo (CRM, correo, voz, pagos, firma…)            | `packages/integrations/<área>/` detrás de su interfaz      |
| Pantallas, API, webhooks, funciones Inngest                      | `apps/web/`                                                |
| Algo que necesita navegador o IP fija                            | `apps/worker-browser/`                                     |
| Cálculo de máquinas, límites o coste                             | `packages/capacity/`                                       |

Si dudas entre `core` y tu agente: lo que usan dos agentes va en `core`.

## 3. El ciclo de un cambio

1. **Un issue por tarea.** Cada tarea atómica del plan (`F5.7`, `F8.3`…) es un
   issue. Si lo que quieres hacer no está en el plan, ábrelo como _feature_ y
   espera decisión antes de escribir código.
2. **Una rama por tarea**, con el ID delante:
   `feat/f5.7-puntuacion-encaje`, `fix/f7.8-rebotes-gmail`.
3. **Tests primero** cuando el comportamiento se puede describir antes
   (reglas, gates, máquinas de estados, cálculos). En UI, después.
4. **Un PR por tarea**, con la plantilla rellenada de verdad: qué has probado y
   qué riesgo tiene. "Todo bien" no es una prueba.
5. **Changeset** si cambias el comportamiento de un paquete compartido:
   `pnpm changeset`.
6. **Revisión.** CODEOWNERS asigna al responsable del área. Una aprobación
   mínimo. Squash merge.

## 4. Commits

[Conventional Commits](https://www.conventionalcommits.org/), validados por
commitlint. El scope es obligatorio y está cerrado a la lista de
`commitlint.config.mjs`.

```
feat(prospecting): puntuar el encaje con motivo explicable (F5.7)
fix(email): no enviar a direcciones en la lista de supresión (F7.5)
docs(adr): decidir proveedor de voz
test(coordinator): la respuesta por email cancela LinkedIn y llamada
```

Al final del cuerpo, `Refs F5.7` con el ID de la tarea.

## 5. Lo que hace que un PR se rechace

- Un `any`, un `@ts-ignore` o un `as unknown as` para callar al compilador.
- Una tabla, consulta o evento sin `tenant_id`.
- Un secreto, un token o una clave en el código, en un test o en un fixture.
- Una llamada a un modelo fuera de `packages/llm`.
- Texto de prompt de un tenant concreto dentro del repo.
- Un agente que no aparece en el Estudio, no tiene ficha en `docs/agents/` o no
  es diagnosticable por el Copiloto (Definición de Hecho transversal).
- Lógica nueva sin test, o un test que pasaría igual con la lógica rota.
- Contenido externo (prospecto, web, email) tratado como instrucción.
- Un PR que mezcla dos tareas.

## 6. Datos de prueba y sandbox

**En staging y en previews es técnicamente imposible escribir a un prospecto
real.** El interceptor de sandbox bloquea todo destinatario que no esté en la
lista blanca y falla cerrado. No lo desactives, no lo puentees en un test con un
mock que se salte la comprobación, y no añadas a la lista blanca a nadie que no
haya aceptado participar.

Nunca uses datos personales reales en fixtures ni en tests. Los tenants de prueba
son **TurbineH** (datos reales propios) y **Clínica Aurora Demo** (ficticio).

## 7. Preguntas

Si algo de este documento o del plan no está claro, pregunta antes de escribir
código. Una decisión aclarada en un comentario cuesta minutos; una asumida mal
cuesta una fase.
