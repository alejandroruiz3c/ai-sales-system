---
'@sales-os/db': minor
'@sales-os/core': minor
---

Esquema del núcleo multi-tenant con RLS en la propia migración, y contratos de eventos del bus.

`@sales-os/db` pasa de paquete reservado a la frontera real con Postgres: siete migraciones con `tenant_id` y política RLS en cada tabla, `events` y `spend_ledger` append-only por trigger, secretos de tenant que una sesión de usuario no puede leer, y tres únicas formas de consultar (`conRLS`, `comoSistema`, `conRolAnonimo`). Las pruebas corren contra Postgres embebido, así que el test de fuga entre corporates está dentro de `pnpm verify`.

`@sales-os/core` gana los contratos de eventos del plan §2.5: la lista de nombres versionados que el bus reconoce, su validación con Zod y las claves de concurrencia, que siempre incluyen el tenant.
