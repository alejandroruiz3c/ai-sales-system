# @sales-os/db

Esquema, migraciones versionadas, políticas RLS y **el único acceso a Postgres**
del sistema.

## Lo que este paquete garantiza

Cuatro cosas, y las cuatro tienen test:

1. **Toda tabla lleva `tenant_id` y RLS.** Un test recorre `pg_class` y falla si
   aparece una que no, o una con RLS desactivado. Las dos excepciones —`perfiles`
   y `tenants`— están enumeradas en `TABLAS_SIN_TENANT_ID` con su motivo y
   justificadas en el [ADR 0009](../../docs/adr/0009-tablas-de-plataforma-sin-tenant-id.md).
2. **Solo hay tres formas de consultar**, y las tres fijan el rol dentro de su
   transacción: `conRLS` (rol `authenticated` con la identidad del usuario),
   `comoSistema` (rol `service_role`, que **salta RLS** y exige un motivo por
   escrito) y `conRolAnonimo`. El manejador crudo de postgres.js no se exporta,
   así que no hay una cuarta puerta que acordarse de cerrar.
3. **`events` y `spend_ledger` son append-only por trigger**, no por convención.
   Es la condición con la que el [ADR 0002](../../docs/adr/0002-stack.md) aceptó
   Inngest en la ruta crítica: la tabla es la fuente de verdad, no la cola.
4. **Un secreto de tenant no es legible con una sesión de usuario.** La tabla
   `tenant_secrets` no tiene políticas ni privilegios para `authenticated`, y la
   función que devuelve el valor solo la puede ejecutar `service_role`.

## Por qué SQL a mano y no SQL generado

`drizzle-kit generate` genera tablas y no genera políticas RLS, y `CLAUDE.md`
pide que la política vaya **en la misma migración que la tabla**. Así que las
migraciones son SQL escrito a mano en `migraciones/NNNN_nombre.sql`, y Drizzle
se usa para consultar con tipos.

El riesgo evidente de tener dos descripciones del mismo esquema es que se
separen, así que hay un test que las compara: `pruebas/deriva-de-esquema.test.ts`
aplica las migraciones a un Postgres de verdad y contrasta tabla por tabla,
columna por columna y `not null` por `not null` con `src/esquema`.

## Órdenes

```bash
pnpm db:migrar                      # aplica lo que falte
pnpm db:migrar --listar             # dice qué falta y no toca nada
pnpm eventos:reproceso --tenant …   # reinyecta eventos (runbook de reproceso)
```

Las dos leen `DATABASE_DIRECT_URL`, y `DATABASE_URL` si la primera no está. La
conexión **directa** es la correcta para migrar: el pooler en modo transacción
no conserva estado de sesión, y una migración a medias es peor que una que no
arranca. Ninguna de las dos imprime la cadena de conexión, ni completa ni
recortada: lleva la contraseña de la base (regla permanente 4). Imprimen el
host, que es lo que hace falta para saber contra qué entorno estás.

## Por qué el andamiaje de pruebas imita también los defectos de Supabase

`pruebas/shim-supabase.sql` no reproduce solo lo que Supabase trae de bueno.
Reproduce también sus `alter default privileges`, que conceden **todos** los
privilegios sobre cada tabla nueva de `public` a `anon`, `authenticated` y
`service_role`.

Eso importa porque sin ellos había un test que pasaba por el motivo equivocado.
«El rol anónimo no tiene privilegios sobre ninguna tabla» era cierto en PGlite
—que no concede nada— mientras en staging `anon` tenía `TRUNCATE` sobre la tabla
`events`, y `truncate` **no pasa por RLS**. Lo arregla la migración 0008; lo
detecta el test solo desde que el andamiaje concede lo mismo que Supabase.

La lección, para la próxima vez que se añada un doble de un servicio: un doble
que solo imita lo que el servicio hace bien convierte los tests en una opinión.

## Las pruebas corren contra Postgres de verdad

`pruebas/` levanta **PGlite**, que es Postgres compilado a WebAssembly: mismas
políticas, mismos roles, mismos triggers. Dos motivos:

- Lo que hay que demostrar es un comportamiento de la base. Un test con dobles
  demuestra que el código llama a lo que creemos que llama, que es justo lo que
  no falla.
- Corre **sin Docker**, y eso es lo que lo hace posible: estos tests están dentro
  de `pnpm verify`, y `pnpm verify` corre dentro del build de Vercel. Un test de
  fuga entre corporates que solo se pueda ejecutar a mano no es una puerta de
  calidad.

`pruebas/shim-supabase.sql` reproduce lo que Supabase ya trae y PGlite no: el
esquema `auth`, `auth.uid()` y los roles `anon`, `authenticated` y
`service_role`. **Ese fichero nunca se aplica a una base real.**

Vault no existe en PGlite, así que el ida y vuelta de un secreto cifrado se
comprueba contra staging, no aquí. Lo que sí se comprueba aquí son los permisos,
que es lo que puede romperse en un PR distraído.

## Migraciones

| Fichero                           | Qué trae                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `0001_fundaciones.sql`            | `perfiles`, `tenants`, `memberships`, `invitaciones`, funciones de pertenencia |
| `0002_eventos_y_aprobaciones.sql` | `events` (append-only), `event_runs`, `event_reinyecciones`, `approvals`       |
| `0003_archivos.sql`               | `tenant_files`, `tenant_file_versions` y políticas de Storage                  |
| `0004_configuracion.sql`          | `agent_configs`, `flow_configs`, versionado append-only                        |
| `0005_secretos.sql`               | `tenant_secrets` sobre Vault                                                   |
| `0006_coste_y_maquinas.sql`       | `tenant_budgets`, `spend_ledger`, `machines`, `app.cobrar_llamada`             |
| `0007_operaciones.sql`            | crear tenant, aceptar invitación, resolver aprobación, purga demo              |

Una migración aplicada **no se edita**: se escribe otra encima. El registro
guarda el sha256 de cada una y el arranque aborta si cambia, porque una
migración editada significa que la base y el repositorio describen bases
distintas y desde el repositorio no se puede saber cuál de las dos miente.
