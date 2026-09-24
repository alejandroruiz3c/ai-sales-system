# ADR 0009 · Tablas de plataforma sin `tenant_id`

- **Estado:** Propuesto
- **Fecha:** 2026-09-24
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F1.1, F1.2
- **Relacionado:** [ADR 0003](0003-multi-tenant-rls.md)

---

## Contexto

`CLAUDE.md` §1 dice, sin matices: **«Toda tabla lleva `tenant_id` y política
RLS. Una tabla sin las dos cosas no pasa revisión»** (ADR 0003, punto 1). La
regla es buena precisamente porque no admite juicio caso a caso: en cuanto una
tabla se salta el `tenant_id` «porque es distinta», la siguiente también lo
hace, y el aislamiento pasa a depender de que alguien recuerde por qué.

Al construir F1 aparece una tabla que, sinceramente, no puede llevar
`tenant_id`: **`perfiles`**. Guarda el nombre y el correo de una persona, y su
condición de administrador de plataforma. Y una persona **no pertenece a un
tenant**: el caso T1.2 del kit de prueba exige que el mismo usuario sea lector
en un corporate y pueda ser editor en otro, y el selector de tenant del panel no
tiene sentido si no es así.

Ponerle un `tenant_id` tendría una de estas tres consecuencias, todas peores que
la excepción:

1. **Una fila de perfil por tenant.** El nombre de una persona duplicado tantas
   veces como corporates, desincronizándose a la primera edición.
2. **Un `tenant_id` nulo**, que es la excepción disfrazada de columna y además
   rompe la política: `tenant_id = any(mis_tenants)` nunca casa con null, así
   que nadie vería su propio perfil.
3. **Un tenant «de plataforma»** al que pertenecerían todos los usuarios. Eso es
   un tenant precargado, que la regla permanente 3 prohíbe explícitamente y que
   `pnpm sistema-vacio` detecta por los nombres con los que suele aparecer (ver
   la regla `tenant-precargado` de `scripts/terminos-vetados.json`).

Hay además una segunda tabla en la misma situación por otro motivo:
**`tenants`**. Su columna de tenant es su propia clave primaria, `id`.

## Decisión

**La regla no se relaja: se hace explícita y comprobable.**

Toda tabla del esquema `public` cumple **una** de estas dos condiciones:

1. lleva `tenant_id` y una política RLS que lo compara con la pertenencia del
   usuario; **o**
2. está en una **lista escrita** de tablas de plataforma, con su motivo, y su
   política RLS se apoya en `auth.uid()` en lugar de en el tenant.

La lista vive en el código, no en este documento:
`TABLAS_SIN_TENANT_ID`, en `packages/db/src/esquema/index.ts`. Hoy tiene dos
entradas:

| Tabla      | Por qué no lleva `tenant_id`                                             | Cómo se aísla                                                                |
| ---------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `perfiles` | La identidad de una persona es anterior a los tenants y atraviesa varios | Por `auth.uid()`: cada uno ve su fila, y las de quien comparte tenant con él |
| `tenants`  | Es la tabla del propio tenant: su columna de tenant es `id`              | Por `app.es_miembro(id)`, que es la misma comprobación con otro nombre       |

Y **el test la lee**: `packages/db/pruebas/rls.test.ts` recorre `pg_class`,
comprueba que toda tabla de `public` tiene RLS activado y que las que no llevan
`tenant_id` están en esa lista. Añadir una tabla sin `tenant_id` y sin apuntarla
rompe `pnpm verify`, que rompe el build de Vercel, que deja el PR en rojo.

Tres detalles del aislamiento de `perfiles`, porque la excepción solo es
defendible si es más estrecha que la regla, no más ancha:

- **Nadie puede enumerar los usuarios del sistema.** La política de lectura es
  «mi fila, o la de alguien con quien comparto un tenant activo»
  (`app.comparte_tenant`). Un lector de un corporate no puede saber quién más
  usa SALES OS.
- **Nadie se asciende a administrador de plataforma.** La política de escritura
  deja actualizar la fila propia, pero el privilegio concedido es
  `update (nombre)`: la columna `es_admin_plataforma` no está en el `grant`, así
  que el intento no llega ni a evaluarse.
- **Un perfil no da acceso a ningún dato de negocio.** Todo lo que es de un
  corporate está en una tabla con `tenant_id`, y esa sí sigue la regla general.

Fuera de `public` hay una tercera tabla, `app.migraciones`, que tampoco lleva
tenant y no entra en esta discusión: el esquema `app` es de la plataforma por
definición y no guarda datos de tenant. Esa separación es justo lo que permite
que la comprobación recorra `public` entero sin excepciones que discutir.

## Consecuencias

**A favor**

- La regla sigue siendo absoluta en la práctica, porque la excepción está
  enumerada y verificada por una máquina en cada PR.
- El coste de añadir una excepción nueva es escribir su motivo en un array y
  defenderlo en una revisión. Es el coste correcto: bajo, pero visible.

**En contra, y asumido**

- **Hay dos formas de aislar en el sistema en lugar de una.** Quien lea una
  política de `perfiles` esperando `tenant_id` no lo va a encontrar. Mitigación:
  el comentario está en la migración, junto a la tabla, y este ADR se nombra
  ahí.
- **La lista puede crecer por comodidad.** Mitigación: no hay ninguna razón
  prevista para que crezca. Si en el futuro hace falta una tabla de plataforma
  más (por ejemplo, un catálogo de modelos de LLM), lo honesto es preguntarse
  antes si de verdad no es configuración de tenant.

## Alternativas consideradas

1. **`perfiles` en el esquema `auth` de Supabase**, como columnas de
   `auth.users.raw_user_meta_data`. Evita la excepción y crea otra peor: los
   metadatos de `auth.users` los puede editar el propio usuario con su sesión,
   así que `es_admin_plataforma` sería autoasignable. Rechazada por eso.
2. **Sin tabla de perfiles**, leyendo el correo del JWT. Funciona para el correo
   y no para el nombre ni para el rol de plataforma, y obliga a consultar el
   servicio de auth para pintar una lista de miembros. Rechazada.
3. **`perfiles` con `tenant_id` y una fila por pertenencia.** Es la opción 1 del
   contexto. Rechazada: duplica el dato y lo desincroniza.

## Decisión de Alex

_Pendiente._
