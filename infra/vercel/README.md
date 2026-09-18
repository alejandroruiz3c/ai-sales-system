# Vercel · plano de control

El panel, la API, los webhooks y las funciones de Inngest se despliegan aquí
(ADR 0004). Los workers de navegador **no**: van a Hetzner.

## Proyecto

Creado el 2026-09-17 en el equipo **TURBINEH** (`turbineh`).

| Ajuste              | Valor                             | Por qué                                                  |
| ------------------- | --------------------------------- | -------------------------------------------------------- |
| Nombre              | `sales-os`                        | —                                                        |
| Equipo              | `turbineh` (TURBINEH)             | —                                                        |
| Repositorio         | `alejandroruiz3c/ai-sales-system` | Previews automáticas por PR (F0.8)                       |
| Rama de producción  | `main`                            | Un push a `main` despliega staging                       |
| Root Directory      | `apps/web`                        | Es un monorepo; Vercel detecta pnpm workspaces desde ahí |
| Framework           | Next.js                           | —                                                        |
| Región de funciones | `fra1` (Fráncfort)                | Todo el tratamiento de datos se queda en la UE           |
| Node                | 22.x                              | Igual que en CI                                          |

`apps/web/vercel.json` fija framework, comandos y región.

**El build ejecuta `pnpm verify` antes de `next build`** (F0.7, ADR 0007):

```json
"buildCommand": "pnpm -w run verify && pnpm build"
```

Si `verify` falla —formato, lint con reglas de seguridad, typecheck, tests,
sistema vacío o `pnpm audit`—, Vercel no construye y no despliega, y el PR
muestra su check en rojo. Con GitHub Actions bloqueado a nivel de cuenta y sin
protección de ramas en el plan gratuito, **este check es la única puerta de
calidad real del repositorio**.

Por eso se ha quitado el `ignoreCommand` con `turbo-ignore` que evitaba
reconstruir el panel cuando un PR solo tocaba documentación: saltarse el build
era saltarse `verify`, y `pnpm sistema-vacio` analiza también los `.md`. Se paga
construyendo los PR de documentación; se gana no tener un hueco por el que entre
un dato de negocio real sin revisión.

## Entornos y dominios

| Entorno de Vercel       | Dominio                      | `SALES_OS_ENV` | Sandbox      |
| ----------------------- | ---------------------------- | -------------- | ------------ |
| Production              | `staging.sales.turbineh.com` | `staging`      | **activo**   |
| Preview                 | URL por PR                   | `preview`      | **activo**   |
| Production real (F14.3) | `sales.turbineh.com`         | `production`   | desactivable |

Sí: mientras dure el desarrollo, el entorno _Production_ de Vercel sirve
**staging**. Es deliberado, porque un dominio fijo solo se puede colgar del
entorno de producción de un proyecto, y el plan pide una URL de staging estable
(§5B.2). Lo que evita el accidente es que `SALES_OS_ENV=staging` mantiene el
sandbox activo: el interceptor no se puede desactivar fuera de
`SALES_OS_ENV=production` (F0.15). En F14.3 se separa el proyecto o el dominio de
producción real.

## DNS del dominio de staging

`turbineh.com` está en el equipo de Vercel pero **con DNS externo** (nameservers
`ns*.ui-dns.*`), así que el subdominio hay que crearlo en el panel del
registrador. Un solo registro:

| Campo    | Valor                                 |
| -------- | ------------------------------------- |
| Tipo     | `CNAME`                               |
| Nombre   | `staging.sales`                       |
| Apunta a | `a4e0d5fdb3283d93.vercel-dns-017.com` |
| TTL      | 3600 (o el que traiga por defecto)    |

El valor es el objetivo específico de este proyecto. Sirve igual el genérico
`cname.vercel-dns.com`, pero el específico es el que Vercel recomienda. Mientras
el registro no exista, el dominio está añadido y verificado en el proyecto pero
`misconfigured: true`, y la URL no resuelve.

## Protección de despliegues

`ssoProtection: all_except_custom_domains`, que es la combinación que hace falta:

- **`staging.sales.turbineh.com` es público.** Tiene que serlo, porque los E2E de
  fase corren contra él desde CI (plan §5B.2) y porque Alex lo abre desde el
  móvil. Lo que evita el accidente no es una contraseña: es el modo sandbox.
- **Las URL `*.vercel.app` piden cuenta de Vercel**, incluidas las previews por
  PR. Alex las abre con su sesión; nadie más ve una preview.

## Variables por entorno

Ver `.env.example`, que dice para qué es cada una y en qué fase se necesita.
Configuradas el 2026-09-17 en los tres entornos (production, preview y
development), salvo las dos primeras, que solo tienen sentido en producción:

```
SALES_OS_ENV                    staging | preview | dev
NEXT_PUBLIC_APP_URL             https://staging.sales.turbineh.com
SANDBOX_MODE                    on
SANDBOX_ALLOWLIST               cifrada
LAB_ACCESS_PASSWORD             cifrada
NEXT_PUBLIC_SUPABASE_URL        proyecto Ai-sales-staging
NEXT_PUBLIC_SUPABASE_ANON_KEY   cifrada
SUPABASE_SERVICE_ROLE_KEY       cifrada
INNGEST_SIGNING_KEY             cifrada
LANGFUSE_HOST                   https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY             cifrada
LANGFUSE_SECRET_KEY             cifrada
```

Alex añadió el 2026-09-17 las que faltaban: `INNGEST_EVENT_KEY`, `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `BETTER_STACK_SOURCE_TOKEN` y
`BETTER_STACK_INGESTING_HOST`.

El proyecto de producción de Supabase (`Ai-sales-prod`) existe pero **no se usa
todavía**: el entorno _Production_ de Vercel sirve staging, así que apunta al
proyecto de staging. Se separa en F14.3.

## Qué NO se pone aquí

Las credenciales de cada corporate (su Pipedrive, sus buzones, sus cuentas de
LinkedIn) no son variables de entorno: van cifradas por tenant en Supabase Vault
(F1.7). Si una credencial pertenece a un corporate, no toca este panel.
