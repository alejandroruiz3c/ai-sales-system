# Vercel · plano de control

El panel, la API, los webhooks y las funciones de Inngest se despliegan aquí
(ADR 0004). Los workers de navegador **no**: van a Hetzner.

## Proyecto

| Ajuste              | Valor                             | Por qué                                                  |
| ------------------- | --------------------------------- | -------------------------------------------------------- |
| Nombre              | `sales-os`                        | —                                                        |
| Repositorio         | `alejandroruiz3c/ai-sales-system` | Previews automáticas por PR (F0.8)                       |
| Root Directory      | `apps/web`                        | Es un monorepo; Vercel detecta pnpm workspaces desde ahí |
| Framework           | Next.js                           | —                                                        |
| Región de funciones | `fra1` (Fráncfort)                | Todo el tratamiento de datos se queda en la UE           |
| Node                | 22.x                              | Igual que en CI                                          |

`apps/web/vercel.json` fija framework, comandos y región. El `ignoreCommand` con
`turbo-ignore` evita reconstruir el panel cuando un PR solo toca documentación o
un paquete que el panel no usa.

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

## Variables por entorno

Ver `.env.example`, que dice para qué es cada una y en qué fase se necesita. En
F0 hacen falta cuatro para que `/status` y `/lab` funcionen del todo:

```
SALES_OS_ENV
NEXT_PUBLIC_APP_URL
SANDBOX_ALLOWLIST
LAB_ACCESS_PASSWORD
```

`SANDBOX_MODE` puede quedarse sin definir: el interceptor asume que está activo.

## Qué NO se pone aquí

Las credenciales de cada corporate (su Pipedrive, sus buzones, sus cuentas de
LinkedIn) no son variables de entorno: van cifradas por tenant en Supabase Vault
(F1.7). Si una credencial pertenece a un corporate, no toca este panel.
