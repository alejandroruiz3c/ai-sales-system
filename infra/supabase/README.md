# Supabase · configuración del proyecto

Región **UE**. Dos proyectos: `staging` y `production` (F0.9).

- `config.toml` de Supabase CLI para desarrollo local — **F1.1**
- Migraciones y políticas RLS — viven en `packages/db`, no aquí
- Vault: secretos por tenant — **F1.7**

Regla que no se negocia: toda tabla lleva `tenant_id` y política RLS. El test
de fuga entre tenants (F1.2) es la puerta de entrada a F2.
