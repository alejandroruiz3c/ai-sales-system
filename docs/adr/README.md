# Architecture Decision Records

Una decisión relevante, un documento. Los ADR no se reescriben a posteriori: si
una decisión cambia, se escribe un ADR nuevo que dice explícitamente a cuál
sustituye. El historial de por qué el sistema es como es tiene que seguir siendo
legible dentro de dos años.

**Estados:** `Propuesto` → `Aceptado` → (`Sustituido por ADR XXXX` | `Rechazado`).
Pasa a `Aceptado` cuando Alex lo aprueba.

| ADR                                     | Decisión                                                  | Estado                                     |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| [0001](0001-reuse-ass.md)               | Qué se reutiliza del Agentic Sales System actual          | Aceptado (pendiente de validación en T0.5) |
| [0002](0002-stack.md)                   | Stack tecnológico                                         | Propuesto                                  |
| [0003](0003-multi-tenant-rls.md)        | Multi-tenant con Row Level Security                       | Propuesto                                  |
| [0004](0004-plano-control-ejecucion.md) | Plano de control en Vercel, plano de ejecución en Hetzner | Propuesto                                  |
| [0005](0005-proveedor-voz.md)           | Proveedor de la plataforma de voz                         | Propuesto                                  |
| [0006](0006-proveedor-firma.md)         | Proveedor de firma electrónica                            | Propuesto                                  |

## Plantilla

```markdown
# ADR XXXX · Título

- **Estado:** Propuesto
- **Fecha:** AAAA-MM-DD
- **Decide:** Alejandro Ruiz
- **Autor:**
- **Tarea del plan:**

## Contexto

Qué problema hay que resolver y qué restricciones existen. Sin solución todavía.

## Decisión

Qué se hace. En presente y en afirmativo.

## Consecuencias

A favor, y en contra. Las consecuencias negativas son obligatorias: un ADR sin
contras es un ADR que no ha pensado.

## Alternativas consideradas

Qué más se valoró y por qué no. Con nombres concretos.

## Pendiente de decisión de Alex

Lo que hace falta para pasar a Aceptado.
```
