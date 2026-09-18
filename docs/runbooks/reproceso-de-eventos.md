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

> **Estado:** procedimiento escrito en F0. La tabla `events` y la herramienta de
> reinyección se implementan en **F1** (modelo de datos y bus de eventos); hasta
> entonces los comandos de abajo son la especificación de lo que F1 tiene que
> entregar, no algo que ya se pueda ejecutar. Cerrar F1 sin esto incumple el
> ADR 0002.

---

## 1. Acotar: ¿qué eventos faltan?

Siempre con `tenant_id`. Un reproceso sin tenant es un reproceso en los datos de
otro corporate.

```sql
-- Eventos publicados que no tienen ejecución registrada, últimas 24 h
select e.id, e.nombre, e.version, e.creado_en, e.tenant_id
from events e
left join event_runs r on r.event_id = e.id
where e.tenant_id = :tenant_id
  and e.creado_en > now() - interval '24 hours'
  and r.id is null
order by e.creado_en;
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

```bash
# Siempre en seco primero: dice qué haría y no publica nada
pnpm eventos:reproceso --tenant <tenant_id> --desde "2026-09-18T08:00:00Z" --dry-run

# Un evento concreto, que es lo preferible
pnpm eventos:reproceso --tenant <tenant_id> --evento <event_id>

# Una ventana, cuando el hueco es amplio
pnpm eventos:reproceso --tenant <tenant_id> --desde "..." --hasta "..."
```

Reglas de la herramienta, que F1 tiene que cumplir:

- **Nunca sin `--tenant`.** Sin tenant, aborta.
- **`--dry-run` por defecto** en producción: publicar exige `--confirmar`.
- **Reutiliza el `event_id` original**, para que la idempotencia del paso 3
  funcione de verdad.
- **Deja rastro**: cada reinyección se apunta con quién, cuándo y por qué.
- **En staging y previews, el interceptor de sandbox sigue activo.** Un
  reproceso no es motivo para desactivarlo.

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
