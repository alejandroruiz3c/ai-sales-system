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

Una sola comprobación antes de abrir un PR:

```bash
pnpm verify
```

Eso es formato, lint (con las reglas de seguridad), typecheck, tests, la
comprobación de sistema vacío y `pnpm audit` a nivel `high`. **Es exactamente lo
mismo que ejecuta el hook `pre-push` y lo mismo que ejecuta Vercel antes de
construir**: una sola definición de «está en verde», no tres listas que se
desincronizan.

```bash
pnpm verify:rapido   # igual pero sin pnpm audit, para iterar en local
pnpm build           # build de producción, si quieres comprobarlo aparte
```

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

## 4. `main` no se toca, y por qué la regla es rara

**Nunca hagas `git push` a `main`.** Ni un arreglo de una línea, ni un cambio de
documentación. Siempre rama y PR.

La regla suena a burocracia hasta que se sabe de dónde viene. El repositorio está
en una cuenta personal de GitHub con plan gratuito
([ADR 0007](docs/adr/0007-github-personal-gratuito.md)), y ese plan **no permite
proteger ramas**. Encima, GitHub Actions está bloqueado a nivel de cuenta desde
abril de 2026. Así que **el check de Vercel sobre el PR es lo único que garantiza
que `main` está desplegable**, porque ejecuta `pnpm verify` antes de construir.
Un commit que no pasa por un PR no ha pasado por ningún control.

Hay tres capas, y conviene saber qué hace cada una:

| Capa                      | Dónde                          | Qué hace                                                      |
| ------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Hook `pre-push`           | Tu máquina                     | Rechaza el push a `main` y ejecuta `pnpm verify`              |
| `pnpm verify` en el build | Vercel, en cada PR y en `main` | **Bloquea**: si falla, no hay despliegue y el check sale rojo |
| Workflow guardián         | GitHub Actions                 | Si aparece un commit en `main` sin PR, abre un issue de aviso |

El hook se instala solo con `pnpm install`. Compruébalo:

```bash
git config core.hooksPath     # tiene que responder .husky/_
```

Sí, `git push --no-verify` se salta el hook. No es un descuido: un hook local
nunca es una garantía. Por eso existe el guardián, que no lo impide pero lo hace
visible el mismo día.

**Si te has equivocado y tienes commits en `main`**, no los empujes:

```bash
git switch -c feat/fX.Y-descripcion     # los commits se vienen contigo
git switch main
git reset --hard origin/main            # main vuelve a estar limpio
git switch feat/fX.Y-descripcion
```

### Revisión

`CODEOWNERS` usa usuarios individuales, no equipos: los equipos necesitan una
organización de GitHub, que no existe todavía. Junto a cada área hay un
comentario con el equipo que le corresponderá. La consecuencia práctica: la
revisión es **obligatoria por norma pero no está bloqueada técnicamente**.
Mientras Alex sea el único revisor, aprueba y fusiona sus propios PR.

## 5. Commits

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

## 6. Lo que hace que un PR se rechace

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
- Un commit que ha llegado a `main` sin pasar por un PR (sección 4).

## 7. Datos de prueba y sandbox

**En staging y en previews es técnicamente imposible escribir a un prospecto
real.** El interceptor de sandbox bloquea todo destinatario que no esté en la
lista blanca y falla cerrado. No lo desactives, no lo puentees en un test con un
mock que se salte la comprobación, y no añadas a la lista blanca a nadie que no
haya aceptado participar.

Nunca uses datos personales reales en fixtures ni en tests, y **nunca datos de
negocio reales**: ni un corporate, ni un producto, ni un precio, ni un ICP, ni un
argumentario, tampoco el de TurbineH. SALES OS nace vacío; todo el conocimiento
comercial entra por el onboarding de cada corporate y vive en la base de datos de
su tenant (plan §0, regla permanente 3 de `CLAUDE.md`).

Los corporates de prueba son ficticios y se dan de alta desde el propio panel:
**Clínica Aurora Demo** y **Logística Norte Demo**. Si necesitas un fixture con
perfil comercial, invéntalo y márcalo con el comentario `CORPORATE FICTICIO`, que
es lo que busca la comprobación de `pnpm sistema-vacio`.

## 8. Claves y secretos

Ningún secreto entra en el repositorio. Los de plataforma viven en Vercel y en
GitHub Environments; los de cada corporate, cifrados en Supabase Vault (F1.7).
En el repo solo está `.env.example`, **sin valores**.

Alex mantiene un fichero `KEYS.rtf` en su carpeta del proyecto, fuera de git
(regla permanente 4 de [`CLAUDE.md`](CLAUDE.md)). Si trabajas con IA en este
repositorio, esto te afecta directamente:

- **Ningún valor de `KEYS.*` se muestra, se copia, se registra ni se escribe** en
  ningún sitio: ni en un chat, ni en un fichero, ni en un commit, ni en un log, ni
  «enmascarado». Un enmascarado mal hecho filtra igual.
- Los valores se pasan **directamente** a la herramienta que los necesita
  (`vercel env add`), por entrada estándar o por el entorno del proceso hijo.
  Nunca por un fichero intermedio.
- `KEYS.*` está excluido de git (`.gitignore`), de los despliegues
  (`.vercelignore`) y del índice del Copiloto (`.copilotignore`).
- **`pnpm sistema-vacio` falla si un `KEYS.*`, un `.env` o un `.pem` llega a estar
  versionado**, y corre dentro de `pnpm verify`, o sea antes de cada push. Es lo
  que sustituye a la _push protection_ de GitHub, que el plan gratuito no incluye.

Si una clave acaba donde no debe —un log, un mensaje, un fichero temporal—,
**dilo y pide que se rote inmediatamente**. Una clave rotada cuesta cinco
minutos; una filtrada y callada cuesta el tenant.

## 9. Preguntas

Si algo de este documento o del plan no está claro, pregunta antes de escribir
código. Una decisión aclarada en un comentario cuesta minutos; una asumida mal
cuesta una fase.
