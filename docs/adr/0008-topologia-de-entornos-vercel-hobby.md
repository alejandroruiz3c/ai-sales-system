# ADR 0008 · Topología de entornos con Vercel Hobby

- **Estado:** Aceptado
- **Fecha:** 2026-09-18
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.8 y F0.14 · se revierte en F14.3

---

## Contexto

El plan pide una URL de staging **estable** (§5B.2) para que Alex la abra cuando
quiera y para que los tests E2E de cada fase corran contra ella. En Vercel, un
dominio propio solo se puede colgar de un entorno con dominio fijo, y en el plan
Hobby el único entorno con dominio fijo es **Production**.

De ahí la situación de hoy: el proyecto `turbineh/sales-os` tiene un único
entorno de producción, y ese entorno **sirve staging**:

| Entorno de Vercel | Dominio                      | `SALES_OS_ENV` | Supabase           |
| ----------------- | ---------------------------- | -------------- | ------------------ |
| Production        | `staging.sales.turbineh.com` | `staging`      | `ai-sales-staging` |
| Preview           | URL por PR                   | `preview`      | `ai-sales-staging` |
| Development       | local                        | `dev`          | `ai-sales-staging` |

El 2026-09-18 se planteó cambiarlo para que Production apuntara a
`ai-sales-prod` y Preview/Development a `ai-sales-staging`. Se evaluaron tres
opciones y **Alex eligió la C**.

## Decisión

**Un solo proyecto de Vercel. `Production` sigue sirviendo
`staging.sales.turbineh.com` con la base de datos `ai-sales-staging` hasta
F14.3.** Es una desviación deliberada del modelo habitual de entornos, está
documentada aquí, en `docs/entregas/F0.md` y en el plan (§4), y se revierte en
F14.3 con las subtareas F14.3a–F14.3f.

### Por qué esta y no las otras

| Opción                        | Qué implica                                                                                          | Por qué no                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A · Dos proyectos**         | `sales-os-staging` → staging, `sales-os` → producción real                                           | Duplica variables y builds: cada PR construye dos previews. Adelanta a F0 un trabajo de F14 sin ningún beneficio hoy |
| **B · Entorno personalizado** | Un proyecto, `Production` → prod y un entorno `staging` con dominio propio. Es lo correcto de verdad | **Los Custom Environments requieren Vercel Pro.** El equipo `turbineh` está en plan `hobby`                          |
| **C · Dejarlo (elegida)**     | Production sigue sirviendo staging hasta F14.3                                                       | —                                                                                                                    |

El argumento de fondo: **en F0 no hay nada que desplegar a producción.** El
sistema nace vacío (regla permanente 3), no hay tenants, no hay datos de negocio
y `ai-sales-prod` está creado y sin usar. Montar hoy la separación de entornos
sería construir la infraestructura de un entorno que no tiene contenido.

### Qué evita el accidente, ya que no lo evita la topología

Que Production se llame «Production» y sirva staging es precisamente el tipo de
confusión que provoca un envío real por error. Lo que lo impide **no es el
nombre del entorno**, son tres cosas que no dependen de él:

1. **`SALES_OS_ENV=staging`**, no `production`. El interceptor de sandbox se
   activa por esa variable.
2. **El interceptor no se puede desactivar** fuera de `SALES_OS_ENV=production`
   (F0.15), y **falla cerrado**: si no sabe si un destinatario está permitido, lo
   bloquea. No es editable desde el Estudio.
3. **`ai-sales-prod` no está conectado a nada.** No hay credenciales de ese
   proyecto en ningún entorno de Vercel, así que ningún despliegue puede
   escribir en él ni por error ni a propósito.

En `/status` se ve el entorno efectivo y el estado del sandbox, así que la
desviación es visible desde el propio sistema y no solo en un documento.

## Vercel Hobby no permite uso comercial

Esto es una consecuencia de la decisión y hay que decirla sin rodeos: **los
términos de Vercel prohíben el uso comercial en el plan Hobby.** Mientras el
sistema esté vacío y solo lo abra Alex, es desarrollo. En el momento en que haya
**un corporate real**, aunque sea uno y aunque sea en piloto, el uso pasa a ser
comercial.

Por tanto: **hay que contratar Vercel Pro antes de dar de alta el primer
corporate real (F14.5), no después.** No es una optimización ni una decisión de
coste que se pueda posponer: es una condición de cumplimiento de los términos del
proveedor, y un proyecto suspendido por incumplirlos se lleva por delante el
panel, la API y los webhooks de todos los tenants a la vez.

Ventaja secundaria, y por eso las dos cosas se resuelven juntas: **Pro desbloquea
los Custom Environments**, que es la opción B de arriba. Es decir, el mismo paso
que hace legal el uso comercial es el que permite hacer bien la separación de
entornos.

## Plan de migración (F14.3)

Se ejecuta **antes** de F14.5 (alta del primer corporate real). Está desglosado
en el plan y en `scripts/backlog.json` como F14.3a–F14.3f:

| Subtarea   | Qué                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F14.3a** | Contratar **Vercel Pro** en el equipo `turbineh`. Bloqueante: sin esto no hay uso comercial legítimo                                                                                                           |
| **F14.3b** | Crear el **Custom Environment `staging`** y mover `staging.sales.turbineh.com` a él, con `SALES_OS_ENV=staging` y las credenciales de `ai-sales-staging`                                                       |
| **F14.3c** | Repuntar **Production** a `sales.turbineh.com` con `SALES_OS_ENV=production` y las credenciales de `ai-sales-prod`, y su CNAME en el registrador                                                               |
| **F14.3d** | Migrar las variables por entorno: Supabase, Inngest, Langfuse, Sentry y la **fuente de logs de producción** (hoy los tres entornos comparten la de staging)                                                    |
| **F14.3e** | Aplicar las **migraciones de base de datos en `ai-sales-prod`** y comprobar que arranca vacío (enlaza con F14.4)                                                                                               |
| **F14.3f** | Comprobar el corte: E2E de las fases entregadas contra el nuevo `staging`, `/status` en verde en los dos entornos, y que el sandbox **sigue activo** en staging y **solo entonces** desactivable en producción |

Orden importante: **F14.3a primero y F14.3f al final**. Entre medias, staging
puede estar unos minutos apuntando a un dominio nuevo, así que la ventana se
elige cuando no haya una fase en validación.

## Consecuencias

**A favor**

- Coste cero hoy, y cero trabajo tirado: nada de lo montado en F0 se rehace.
- Una sola URL estable que Alex ya usa y contra la que ya corren 15 tests E2E.
- La separación de entornos se hace **una vez y bien**, con Custom Environments,
  en vez de dos veces y a medias.

**En contra, y hay que tenerlo presente**

- **El nombre del entorno miente.** «Production» en el panel de Vercel es
  staging. Cualquiera que llegue nuevo al proyecto lo va a leer mal, y por eso
  está escrito en tres sitios.
- **No hay un entorno de producción de verdad** hasta F14.3. No se puede probar
  nada específico de producción —por ejemplo, el comportamiento con el sandbox
  desactivado— antes de esa fase.
- **`ai-sales-prod` lleva semanas creado y sin migraciones.** Cuando se use en
  F14.3e habrá que aplicarlas todas de golpe, que es más arriesgado que haberlas
  ido aplicando. Lo cubre F14.3e explícitamente.
- **Hay una dependencia de plan de pago en la ruta crítica del negocio**: sin
  Vercel Pro no se puede dar de alta el primer corporate. Está en F14.3a para que
  no aparezca como sorpresa el día del alta.
- **`scripts/e2e-staging.mjs` tiene el entorno `production` fijado** como origen
  de la contraseña de `/lab`. En F14.3b hay que cambiar esa constante.

## Alternativas consideradas

Las tres opciones A, B y C están en la tabla de arriba con su motivo. Se
descartó además una cuarta: **no tener URL fija de staging** y usar la preview
de cada PR. Rompe §5B.2 (los E2E de fase necesitan un objetivo estable) y obliga
a Alex a buscar una URL distinta cada vez que quiere ver el sistema, que es la
forma más segura de que deje de mirarlo.
