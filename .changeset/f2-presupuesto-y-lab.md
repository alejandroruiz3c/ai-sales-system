---
'@sales-os/db': minor
'@sales-os/llm': minor
'@sales-os/core': patch
'@sales-os/prompts': patch
---

Presupuesto real para el router (F2.5): migración 0010 con reservas de gasto (`app.autorizar_gasto` / `app.liquidar_gasto`), tokens de caché y modo en el libro de gasto, y el arreglo del bloqueo del presupuesto para editores (también en `cobrar_llamada`). Adaptador `crearPresupuestoDeGasto`. Trazas de Langfuse por OpenTelemetry en lugar de la API de ingesta obsoleta. Eventos `llm.batch.submitted` y `llm.batch.completed`. Plantilla de clasificación: una ausencia «hasta» una fecha usa esa fecha.
