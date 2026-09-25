---
'@sales-os/llm': minor
---

Router de modelos (F2.1, F2.2, F2.4, F2.5, F2.8): elige el modelo más barato capaz de cada nivel de tarea, cachea el bloque fijo del prompt, valida la salida con Zod con un único reintento, reserva el coste máximo en el presupuesto antes de llamar y liquida el real después, y traza en Langfuse por tenant y agente. Interfaz `ModelProvider` con proveedor de Anthropic y proveedor simulado intercambiables, y modo lote sobre la Batch API.
