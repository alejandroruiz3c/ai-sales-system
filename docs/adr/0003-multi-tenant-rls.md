# ADR 0003 · Multi-tenant con Row Level Security

- **Estado:** Aceptado
- **Fecha:** 2026-09-16 · **Aceptado:** 2026-09-18
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.12

---

## Contexto

SALES OS guarda para cada corporate su lista de prospectos, sus conversaciones,
sus precios y sus credenciales. Que un tenant vea datos de otro no es un bug: es
el final del producto. El plan lo marca como innegociable (caso T1.3: "si falla,
se para todo").

El sistema antiguo no tenía ninguna noción de tenant: separaba las unidades de
negocio con una columna y confiaba en que el código filtrase bien. Eso funciona
hasta el primer `WHERE` olvidado.

## Decisión

**Aislamiento por base de datos con Row Level Security de Postgres, no por
código de aplicación.**

1. **Toda tabla lleva `tenant_id`**, sin excepción. Una tabla sin `tenant_id` no
   pasa revisión.
2. **Toda tabla tiene RLS activado** y una política que solo permite las filas
   del tenant del usuario autenticado. La política se escribe en la migración,
   junto a la tabla, no en un fichero aparte que alguien olvida aplicar.
3. **La pertenencia vive en `memberships`** (usuario, tenant, rol). Un usuario
   puede pertenecer a varios tenants y cambiar entre ellos.
4. **El acceso normal de la aplicación usa la clave anónima con el JWT del
   usuario**, de forma que RLS se aplica siempre. La `service_role`, que salta
   RLS, se usa solo en trabajos de sistema explícitamente marcados y nunca en un
   camino que atienda una petición de usuario.
5. **Los ficheros se separan en Storage por carpeta de tenant**
   (`/tenants/{id}/context|inputs|outputs`) con políticas equivalentes.
6. **Los secretos de cada tenant van a Supabase Vault**, cifrados, y nunca se
   devuelven al frontend: el backend los usa y devuelve el resultado.
7. **Todo evento lleva el tenant** y toda clave de concurrencia de Inngest lo
   incluye, para que un tenant no pueda consumir la capacidad de otro ni
   provocar que se supere el límite de una máquina ajena.
8. **Un tenant nunca comparte una máquina con otro**: ni buzón, ni cuenta de
   LinkedIn, ni número de teléfono.
9. **Hay un test de fuga** (F1.2) que intenta leer datos de otro tenant y debe
   fallar. Es puerta de entrada a F2: sin ese test en verde, no se avanza.

## Consecuencias

**A favor**

- Un `WHERE` olvidado no filtra datos: la base los oculta igualmente. La
  seguridad deja de depender de que nadie se equivoque nunca.
- El mismo mecanismo cubre panel, API y funciones de Inngest.
- Auditar el aislamiento es leer las políticas, no auditar todas las consultas.

**En contra, y asumido**

- **RLS tiene coste de rendimiento** en consultas grandes. Mitigación: índice por
  `tenant_id` en todas las tablas y políticas escritas para ser indexables
  (comparación directa, no subconsultas correlacionadas por fila).
- **La `service_role` es una llave maestra.** Mitigación: solo en el servidor,
  solo en trabajos de sistema, con revisión reforzada por CODEOWNERS en los
  ficheros donde se usa.
- **El desarrollo local se complica**: hay que autenticarse para ver datos. Es
  el precio de que el camino de desarrollo se parezca al de producción.
- **Los workers de Hetzner están fuera de la frontera de auth.** Mitigación: el
  worker no consulta la base directamente en su nombre; recibe el trabajo con su
  tenant desde el orquestador, con secreto compartido, y devuelve resultados por
  el mismo canal.

## Alternativas consideradas

1. **Una base de datos por tenant.** Aislamiento perfecto y operación insoportable: migraciones × N, conexiones × N, y el planificador de capacidad tendría que razonar sobre bases de datos. Se descarta salvo que un corporate lo exija por contrato; en ese caso sería una excepción documentada, no el modelo.
2. **Un esquema Postgres por tenant.** Mejor que lo anterior y aun así N veces la migración. Con RLS se consigue el mismo aislamiento efectivo con una sola forma de tabla.
3. **Filtrado en el código de aplicación.** Es lo que hacía el sistema antiguo. Un solo olvido y el fallo es silencioso: no da error, devuelve datos de otro. Rechazada.
4. **Filtrado en una capa de servicio obligatoria (repositorio único).** Mejor que filtrar suelto, pero sigue siendo código y sigue admitiendo el atajo. Se usará **además** de RLS, no en su lugar.

## Decisión de Alex (2026-09-18)

**Aceptado.** RLS es el modelo general de aislamiento, y no hay una segunda
forma de hacerlo: toda tabla lleva `tenant_id`, toda tabla lleva política, y una
tabla sin las dos cosas no pasa revisión.

**La base de datos dedicada es una opción premium, bajo petición, con
sobrecoste.** No es el plan por defecto ni una promesa comercial que se pueda
hacer sin hablarlo. Cuando un corporate la pida:

- se trata como una excepción con su propio presupuesto, no como una variante
  del producto;
- el código **no se bifurca**: el acceso sigue pasando por `packages/db` y por
  las mismas políticas, y lo que cambia es la cadena de conexión del tenant;
- se escribe un ADR nuevo con las consecuencias de operación (migraciones,
  copias de seguridad, coste de tener N bases en vez de una).

El motivo de que sea excepción y no norma: una base por corporate multiplica el
coste de cada migración por el número de clientes, y ese coste lo paga el equipo
en cada despliegue, para siempre.
