# FX · Informe de entrega

> Plantilla del informe que cierra cada fase (F0.18). Cópiala a `FX.md`.
>
> Lo escribe Claude Code al terminar la fase, **antes de detenerse**. Después no
> se empieza nada nuevo hasta que Alex escriba `GO FX` (CLAUDE.md, regla
> permanente 1).

- **Fase:** FX · <nombre>
- **Fecha:** AAAA-MM-DD
- **Commit desplegado:** `<sha>`
- **Estado:** pendiente de validación de Alex

---

## 1. Dónde probarlo

| Qué                 | Dónde                                              |
| ------------------- | -------------------------------------------------- |
| Staging             | https://staging.sales.turbineh.com                 |
| Estado de servicios | https://staging.sales.turbineh.com/status          |
| Sala de pruebas     | https://staging.sales.turbineh.com/lab             |
| Repositorio         | https://github.com/alejandroruiz3c/ai-sales-system |

## 2. Qué puedes probar

Una lista corta, en orden, de lo que Alex puede hacer con el navegador. Cada
punto con lo que tiene que ver si funciona. Sin jerga.

## 3. Resultado de las pruebas automáticas

| Comprobación                  | Resultado |
| ----------------------------- | --------- |
| `pnpm lint`                   |           |
| `pnpm typecheck`              |           |
| `pnpm test` (unitarios)       |           |
| `pnpm build`                  |           |
| E2E de la fase contra staging |           |

Si algo está en rojo o se ha omitido, aquí se dice cuál y por qué.

## 4. Tareas de la fase

| ID  | Tarea | Estado |
| --- | ----- | ------ |

Estados: **hecho**, **hecho y sin verificar en vivo** (falta una cuenta o una
clave), **bloqueado** (con qué lo bloquea).

## 5. Limitaciones conocidas

Lo que no hace, lo que es provisional y en qué fase deja de serlo. Un apartado
vacío aquí casi siempre significa que no se ha mirado.

## 6. Qué necesito de ti

| #   | Qué | Para qué | Dónde se configura |
| --- | --- | -------- | ------------------ |

Cada fila tiene que ser accionable sin volver a preguntar: nombre exacto de la
variable, pantalla exacta del proveedor.

## 7. Decisiones que necesitan tu aprobación

ADR en estado `Propuesto` que bloquean trabajo posterior.

## 8. Kit de prueba

Los casos de esta fase (sección 5B del plan) con una columna para que Alex marque
OK o KO.

| Caso | Qué haces | Resultado esperado | OK / KO | Nota |
| ---- | --------- | ------------------ | ------- | ---- |

---

**Siguiente paso:** Alex ejecuta el kit. Si todo está en OK, escribe `GO FX+1`.
Si algo falla, `KO <caso>` con la captura.
