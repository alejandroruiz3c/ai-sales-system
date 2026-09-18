# ADR 0007 · GitHub personal gratuito: protección de `main` sin plan de pago

- **Estado:** Aceptado
- **Fecha:** 2026-09-18
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.7 (plan v1.4, §4)

---

## Contexto

El plan escribió F0.7 como «protección de `main`, Dependabot, secret scanning,
CodeQL» dando por hecho una organización de GitHub con plan de pago. La decisión
de dirección del 2026-09-18 es que **no habrá organización ni plan de pago**: el
repositorio se queda en `alejandroruiz3c/ai-sales-system`, privado, en una cuenta
personal gratuita.

Eso quita cuatro cosas concretas, y conviene nombrarlas sin adornos:

| Lo que se pierde                        | Consecuencia real                                                       |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Reglas de protección de ramas           | Nada impide técnicamente un `git push` a `main`, ni un force push       |
| Equipos (`@turbineh/sales-os-platform`) | CODEOWNERS no puede repartir por área, y la revisión no se puede exigir |
| CodeQL                                  | No hay análisis estático de seguridad en repos privados gratuitos       |
| Secret scanning con _push protection_   | GitHub no frena un commit con un token dentro                           |

Y hay un quinto problema, que no viene del plan gratuito pero coincide en el
tiempo y agrava los otros: **GitHub Actions está bloqueado a nivel de cuenta**
desde el 2026-04-01. Todas las ejecuciones terminan en `startup_failure` en
menos de un segundo, en todos los repositorios de la cuenta, incluido el workflow
de Dependabot que genera GitHub. No es nuestro YAML y no son los minutos: el
consumo total de la cuenta en 2026 son 4 minutos, descontados por la cuota
gratuita. Está pendiente de resolver con la facturación de GitHub o con Soporte.

Conclusión incómoda pero útil: **no se puede confiar en GitHub como puerta de
calidad.** Si la garantía de que `main` está desplegable depende de Actions, hoy
no hay ninguna garantía.

## Decisión

**Tres capas independientes, ordenadas de la más cercana al desarrollador a la
más lejana. Ninguna es suficiente sola, y la del medio es la que de verdad
bloquea.**

### Capa 1 · Hook `pre-push` (local, se instala solo)

`.husky/pre-push` hace dos cosas:

1. **Rechaza cualquier push a `main`** con un mensaje que explica qué hacer:
   crear la rama, subirla y abrir el PR, y cómo rescatar los commits si ya
   estaban hechos sobre `main`.
2. **Ejecuta `pnpm verify`** antes de subir cualquier rama.

Se instala con `pnpm install` (script `prepare` → `husky`), así que cualquiera
que clone el repositorio lo tiene activo sin hacer nada. Se salta con
`git push --no-verify`, y eso es sabido: un hook local es una red, no una puerta.

### Capa 2 · `pnpm verify` dentro del build de Vercel (la que bloquea)

`apps/web/vercel.json` define `buildCommand: "pnpm -w run verify && pnpm build"`.
Si `verify` falla, **Vercel no construye y no despliega**, y el PR muestra su
check en rojo. Esta es la capa que sustituye de verdad a la protección de rama y
a CI, porque:

- corre en la infraestructura de Vercel, que sí funciona y sí está pagada;
- corre en **cada PR** (preview) y en **cada push a `main`** (production);
- su resultado aparece como check en el PR, que es donde se mira.

`pnpm verify` es una única definición de «está en verde», usada por las tres
capas:

```
pnpm format:check      formato
pnpm lint              ESLint, incluidas las reglas de seguridad de abajo
pnpm typecheck         tsc --noEmit en todos los paquetes
pnpm test              Vitest en todos los paquetes
pnpm sistema-vacio     F0.19 + ningún fichero de claves versionado
pnpm audit --audit-level high
```

Dos consecuencias que se aceptan a sabiendas:

- **Se ha quitado el `ignoreCommand` con `turbo-ignore`.** Antes, un PR que solo
  tocaba documentación no disparaba build, y por tanto no pasaba por `verify`.
  Con Vercel como única puerta, eso era un agujero: `pnpm sistema-vacio` analiza
  markdown, y un dato de negocio real en un `.md` habría entrado sin check. Se
  paga construyendo también los PR de documentación.
- **`pnpm audit` puede romper un despliegue por un aviso nuevo** en una
  dependencia que no hemos tocado. Es el precio de que la auditoría bloquee de
  verdad. La salida no es silenciarlo en el código: se actualiza la dependencia,
  o se declara el aviso en `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`) con
  su motivo, y se revisa en el PR como cualquier otro cambio.

### Capa 3 · Workflow guardián (detección, no prevención)

`.github/workflows/guardian-main.yml` se dispara en cada push a `main`. Si el
commit no es el commit de fusión de un PR fusionado —o si ha habido force
push—, **abre un issue** con el commit, el autor, quién hizo el push y qué
revisar. Es idempotente: un issue por commit, nunca duplicados.

No previene nada. Su valor es el tiempo de detección: descubrirlo el mismo día
es revisar un commit; descubrirlo en un mes es auditar un mes de historia.

Hoy no puede ejecutarse, porque Actions está bloqueado. Se queda escrito y
probado para que funcione en el momento en que se desbloquee. `ci.yml` se
mantiene por lo mismo, ya reducido a `pnpm verify` + `pnpm build` para no
duplicar la definición.

### Lo que sustituye a CodeQL y al secret scanning

Reglas de ESLint en `eslint.config.mjs`, todas dentro de `pnpm verify`. No son un
catálogo genérico copiado de un plugin: cada una tapa un agujero de **este**
sistema, y todas están probadas contra un fichero que las dispara.

| Regla                                        | Qué impide                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Literales con prefijo de secreto             | Un token en el código (`sk-`, `ghp_`, `sntrys_`, `sbp_`…)          |
| `no-eval`, `no-new-func`, `no-script-url`    | Ejecución de código construido en caliente                         |
| Shell por interpolación en `exec`/`execSync` | Inyección de comandos, con workers de navegador y rutas por tenant |
| `dangerouslySetInnerHTML`                    | XSS almacenado desde contenido de un prospecto o una web           |
| `process.env.SUPABASE_SERVICE_ROLE_KEY`      | Saltarse RLS fuera de `packages/db` (ADR 0003)                     |
| `import '@anthropic-ai/sdk'` fuera de `llm`  | Llamadas a modelo sin router, sin caché y sin apunte de coste      |
| `next/*`, `react`, `process.env` en agentes  | Un agente atado a su runtime, con configuración fuera del Estudio  |

Y `pnpm sistema-vacio` (F0.19) crece con una tercera comprobación: **falla si un
`KEYS.*`, un `.env` o un `.pem` llega a estar versionado**. Es lo que
compensa la falta de _push protection_, y va antes del push por el hook.

### CODEOWNERS

Usuarios individuales (`@alejandroruiz3c`), con el equipo previsto anotado en un
comentario junto a cada área. Sirve para dos cosas: pedir revisión automática y
documentar qué áreas son sensibles. **La revisión es obligatoria por norma, no
por bloqueo técnico**; mientras Alex sea el único revisor, aprueba y fusiona sus
propios PR.

### Lo que se retira

- **`scripts/proteger-main.sh`**: pedía protección de rama y CodeQL. Sustituido
  por `scripts/ajustes-github.sh`, que aplica solo lo que el plan gratuito
  permite (squash merge único, borrado de rama al fusionar, alertas de
  Dependabot) y dice en voz alta lo que no puede hacer.
- **`.github/workflows/codeql.yml`**: no disponible en repos privados gratuitos.
  Sustituido por las reglas de ESLint y `pnpm audit`.

## Consecuencias

**A favor**

- La puerta de calidad ya no depende de GitHub. Con Actions caído, `pnpm verify`
  sigue corriendo en cada PR dentro del build de Vercel.
- Una sola definición de «está en verde», compartida por el hook, Vercel y CI.
  No hay tres listas de comprobaciones que se desincronizan.
- Coste cero.

**En contra, y hay que tenerlo presente**

- **Un push a `main` es posible.** `--no-verify`, la web de GitHub o un
  colaborador que no haya ejecutado `pnpm install` lo consiguen. La respuesta es
  detección (capa 3) y norma escrita (regla permanente 4 de `CLAUDE.md`), no
  prevención.
- **`pnpm verify` en el pre-push es lento.** Se acepta: el pre-push es el último
  momento en el que un error cuesta segundos en vez de un ciclo de PR. Existe
  `pnpm verify:rapido` (sin `pnpm audit`) para iterar en local.
- **La revisión por área no se puede exigir.** Con un solo desarrollador es
  teórico; con equipos colaboradores externos deja de serlo, y ese es el momento
  de revisar esta decisión.
- **Sin secret scanning de GitHub.** Un secreto que no encaje en los prefijos de
  la regla de ESLint puede entrar. Los secretos de verdad viven en Vercel y en
  Supabase Vault, y `KEYS.*` está cubierto explícitamente, pero el agujero
  existe.

## Cómo migrar a una organización en el futuro

El flujo de trabajo no cambia: ramas cortas, PR, squash merge, `pnpm verify`.
Solo se **añade** el bloqueo que hoy falta. En orden:

1. **Crear la organización** y su plan de pago (Team basta para protección de
   ramas y equipos; Advanced Security, para CodeQL y secret scanning con push
   protection, es un producto aparte).
2. **Transferir el repositorio**: Settings → Danger Zone → Transfer ownership.
   Se conservan issues, PR, milestones, Projects y el historial. Las URL
   antiguas redirigen.
3. **Reapuntar lo que menciona el repositorio**: `SALES_OS_REPO` en
   `scripts/ajustes-github.sh` y `scripts/seed-github.mjs`, el proyecto de Vercel
   (Settings → Git) y los remotos locales (`git remote set-url`).
4. **Crear los equipos por área** con los nombres ya anotados en `.github/CODEOWNERS`
   y sustituir `@alejandroruiz3c` por el equipo de cada línea.
5. **Activar la protección de `main`**: exigir el check de Vercel y el de CI,
   una revisión aprobatoria, `require_code_owner_reviews: true`, historial lineal,
   sin force push, sin borrado.
6. **Activar CodeQL** y el secret scanning con push protection. Las reglas de
   ESLint **se quedan**: son específicas de este sistema y CodeQL no las cubre.
7. **Revisar el guardián.** Con protección de rama nativa no debería saltar
   nunca. Se deja: un guardián que no salta cuesta nada, y sigue cubriendo el
   force push de un administrador.
8. **Escribir el ADR que sustituya a este**, con la fecha del cambio. Los ADR no
   se reescriben a posteriori.

Nada de esto es urgente. El disparador razonable es el primero de estos tres:
entra un colaborador externo con permiso de escritura, hay más de un revisor, o
se empieza a tratar datos de un corporate real.
