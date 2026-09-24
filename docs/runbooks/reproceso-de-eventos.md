# Runbook · Reproceso de eventos

**Cuándo se usa:** un evento se publicó pero su función no se ejecutó, o se
ejecutó a medias. Síntomas típicos: un prospecto se queda sin primer contacto, una
secuencia se detiene sin motivo, una respuesta entrante no cancela los pasos
siguientes, o Inngest reporta una incidencia en su plataforma.

**Por qué existe este runbook:** Inngest está en la ruta crítica del sistema por
decisión explícita ([ADR 0002](../adr/0002-stack.md)), y la condición para
aceptarlo fue esta: **la cola no es la fuente de verdad, la tabla `events` lo
es**. Todo evento se persiste en Postgres antes de enviarse a Inngest, así que un
evento perdido por la cola sigue existiendo y se puede reinyectar.

> **Estado:** implementado en F1. La tabla `events` existe, es append-only por
> trigger, y `pnpm eventos:reproceso` funciona. Los comandos de abajo se pueden
> ejecutar.
>
> Lo que **no** está probado todavía es un reproceso de verdad, porque en F1
> ningún agente consume eventos: no hay ninguna función a la que reinyectar.
> El primer reproceso con consumidor real llega con F5, y con él la comprobación
> de que la guarda de idempotencia del paso 3 existe en cada función. Hasta
> entonces la herramienta está verificada en lo que se puede verificar: acota
> los huecos, se niega sin `--tenant`, no publica nada sin `--confirmar` y
> apunta cada reinyección.

---

## 1. Acotar: ¿qué eventos faltan?

Siempre con `tenant_id`. Un reproceso sin tenant es un reproceso en los datos de
otro corporate.

```sql
-- Eventos publicados que no tienen ejecución registrada, últimas 24 h.
-- La consulta está en la base como función, para no reescribirla cada vez:
select * from app.eventos_sin_ejecucion(:tenant_id, now() - interval '24 hours', now());
```

Y sin escribir SQL, desde el panel: `/panel/eventos` marca con la etiqueta «sin
ejecución» los eventos publicados que ninguna función ha atendido. Es la misma
consulta con otra cara, y sirve para el primer vistazo.

Y con la herramienta, que hace esa misma consulta y no publica nada:

```bash
pnpm eventos:reproceso --tenant <uuid>
```

Tres respuestas posibles:

| Resultado                       | Qué significa                                            | Sigue por |
| ------------------------------- | -------------------------------------------------------- | --------- |
| No hay huecos                   | El problema no es de entrega: es lógica del agente       | Paso 5    |
| Hay huecos en una ventana corta | Incidencia de la cola                                    | Paso 2    |
| Hay huecos de todo un tenant    | Probable supresión, presupuesto agotado o conexión caída | Paso 5    |

## 2. Confirmar en Inngest antes de tocar nada

Mira el panel de Inngest en el entorno afectado: eventos recibidos, funciones en
error, reintentos agotados. Si los eventos **sí** llegaron y las funciones
fallaron, **no es un caso de reproceso**: es un fallo de la función y se arregla
con un despliegue, porque reinyectar solo repetirá el mismo error.

## 3. Comprobar la idempotencia antes de reinyectar

**Este paso no se salta.** Reinyectar un evento de outreach sin idempotencia
manda un segundo email al mismo prospecto, y eso no se deshace.

Cada función que consume eventos tiene que ser idempotente por
`(tenant_id, event_id)`. Antes de reprocesar, confirma en el código del agente
que existe esa guarda. Si no existe, el arreglo es añadirla, no reprocesar.

## 4. Reinyectar

No hay bandera `--dry-run`: **en seco es el comportamiento por defecto**, y
publicar es lo que hay que pedir. Es al revés que en la especificación que
escribió F0, y a propósito: una herramienta que publica salvo que le digas que
no, publica el día que alguien copia el comando a medias.

```bash
# En seco: dice qué haría y no publica nada
pnpm eventos:reproceso --tenant <tenant_id> --desde "2026-09-18T08:00:00Z"

# Un evento concreto, que es lo preferible
pnpm eventos:reproceso --tenant <tenant_id> --evento <event_id> \
  --motivo "incidencia de Inngest del 18/09" --confirmar

# Una ventana, cuando el hueco es amplio
pnpm eventos:reproceso --tenant <tenant_id> --desde "..." --hasta "..." \
  --motivo "..." --confirmar

# Y el rango entero, no solo los huecos, cuando hace falta
pnpm eventos:reproceso --tenant <tenant_id> --desde "..." --todos --motivo "..." --confirmar
```

Reglas de la herramienta, y dónde se cumple cada una:

| Regla                                                                | Dónde                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Nunca sin `--tenant`.** Sin tenant, aborta                         | Lo primero que comprueba `principal()`, y el mensaje explica por qué                    |
| **En seco por defecto**: publicar exige `--confirmar`                | Sin la bandera, lista lo que haría y recuerda los pasos 2 y 3 antes de dejarte publicar |
| **Solo los huecos por defecto**: `--todos` reinyecta el rango entero | Reinyectar todo un rango cuando faltaban tres eventos es repetir trabajo ya hecho       |
| **Reutiliza el `event_id` original**                                 | Va como `id` del evento de Inngest, que es su clave de deduplicación                    |
| **Deja rastro**: quién, cuándo y por qué                             | Una fila en `event_reinyecciones`, que es append-only como `events`                     |
| **El interceptor de sandbox sigue activo**                           | La herramienta no lo toca y no puede: se activa por `SALES_OS_ENV` y falla cerrado      |

Una nota sobre por qué la herramienta vive en `packages/db` y publica en Inngest
con `fetch` en vez de con su SDK: `packages/db` es la frontera con Postgres y no
debe conocer el orquestador. Si mañana el orquestador cambia, lo que cambia es
ese fichero, y la tabla `events` —que es la fuente de verdad— no se entera. Que
ese cambio sea un trabajo acotado y no una reescritura es justamente lo que el
ADR 0002 compró aceptando Inngest en la ruta crítica.

## 5. Si no era la cola

Recorre, en este orden, las causas que el Copiloto ya sabe diagnosticar:

1. **Supresión**: el destinatario está en la lista de supresión o rebotó.
2. **Presupuesto**: el tenant agotó su presupuesto de modelo y el router cortó.
3. **Límite de capacidad**: el planificador (F13) frenó por límites por máquina o
   por cuenta.
4. **Conexión caída**: el CRM, el buzón o la cuenta de LinkedIn perdieron
   autorización.
5. **Aprobación pendiente**: el paso espera una aprobación humana que nadie dio.

## 6. Cerrar

- Anota en el issue qué eventos se reprocesaron, con su rango y su conteo.
- Si la causa fue un fallo de idempotencia, abre issue con etiqueta `seguridad`:
  un evento reprocesable dos veces es un email duplicado esperando su turno.
- Si la causa fue de Inngest, anótalo en el informe de entrega de la fase en
  curso. Tres incidencias en un trimestre son motivo para revisar el ADR 0002.
