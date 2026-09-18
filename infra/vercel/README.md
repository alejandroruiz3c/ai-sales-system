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
"buildCommand": "pnpm -w run verify && pnpm build && pnpm -w run verify:bundle"
```

Son **dos** comprobaciones, antes y después de construir:

- **Antes**, `pnpm verify`: formato, lint con reglas de seguridad, typecheck,
  tests, sistema vacío, variables públicas y `pnpm audit`.
- **Después**, `pnpm verify:bundle`: rastrea el JavaScript ya construido
  buscando secretos. Existe por el incidente del 2026-09-18, en el que un token
  de Sentry acabó servido en el bundle público: revisar las variables no basta,
  porque un secreto puede llegar al cliente por otros caminos —un literal en un
  componente, datos de servidor serializados en el HTML—. Lo único que ve la
  verdad es lo que el navegador descarga.

Si cualquiera de las dos falla, Vercel no despliega y el PR muestra su check en
rojo. Con GitHub Actions bloqueado a nivel de cuenta y sin
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
**staging**. Es una **desviación deliberada**, decidida por Alex el 2026-09-18 y
documentada en [ADR 0008](../../docs/adr/0008-topologia-de-entornos-vercel-hobby.md):
en el plan Hobby el único entorno con dominio fijo es _Production_, y el plan
pide una URL de staging estable (§5B.2).

Lo que evita el accidente no es la topología, son tres cosas que no dependen de
ella: `SALES_OS_ENV=staging` mantiene el sandbox activo, el interceptor **no se
puede desactivar** fuera de `SALES_OS_ENV=production` y **falla cerrado**
(F0.15), y `ai-sales-prod` **no está conectado a ningún entorno**, así que ningún
despliegue puede escribir en él.

Se revierte en **F14.3** (subtareas F14.3a–F14.3f). Ojo con la primera:
**el plan Hobby de Vercel no permite uso comercial**, así que hay que contratar
Pro antes de dar de alta el primer corporate real (F14.5), no después. El mismo
paso desbloquea los Custom Environments, que es lo que permite separar los
entornos bien.

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

Al día el 2026-09-18, en los tres entornos: `INNGEST_EVENT_KEY`, `SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `BETTER_STACK_SOURCE_TOKEN` y
`BETTER_STACK_INGESTING_HOST`.

**`NEXT_PUBLIC_SENTRY_DSN` tiene que ser el DSN**, con la forma
`https://<clave>@<host>/<idProyecto>`, que es público por diseño. Un token de
organización (`sntrys_…`) o de usuario (`sntryu_…`) **no sirve y no puede ser
público**: el 2026-09-18 esa variable contenía un token de usuario y se estuvo
sirviendo en el bundle público de staging. Ahora lo impiden `pnpm
variables-publicas` y `pnpm verify:bundle`, las dos dentro del build.

**Fuente de logs: hoy los tres entornos comparten la de staging.** Es
consecuencia del ADR 0008 — mientras _Production_ sirva staging, poner ahí la
fuente de producción mandaría los logs de staging a la fuente equivocada. Cada
entrada de log lleva su campo `environment` (`staging`, `preview`, `dev`) para
distinguirlas. **En F14.3d, `Production` pasa a la fuente de producción** y cada
entorno queda con la suya.

El proyecto de producción de Supabase (`Ai-sales-prod`) existe pero **no se usa
todavía**: el entorno _Production_ de Vercel sirve staging, así que apunta al
proyecto de staging. Se separa en F14.3.

## Qué NO se pone aquí

Las credenciales de cada corporate (su Pipedrive, sus buzones, sus cuentas de
LinkedIn) no son variables de entorno: van cifradas por tenant en Supabase Vault
(F1.7). Si una credencial pertenece a un corporate, no toca este panel.
