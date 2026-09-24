# Fichas de agente

Una ficha por agente. Es un requisito de la **Definición de Hecho transversal**
(plan §F2B): sin ficha aquí, el agente no está terminado, porque el Copiloto no
puede explicarlo ni diagnosticarlo.

Cada ficha contiene:

1. **Qué hace** — en una frase que entienda un comercial.
2. **Qué configura** — esquema de configuración y bloques de prompt del Estudio.
3. **Qué eventos consume y emite** — nombres exactos del bus (plan §2.5).
4. **Límites** — por máquina, por ventana horaria, por presupuesto.
5. **Métricas** — qué mide su calidad y cuál es el umbral para subir de nivel de autonomía.
6. **Problemas frecuentes** — con la regla de diagnóstico que usa el Copiloto.

| Agente               | Fase | Ficha                  |
| -------------------- | ---- | ---------------------- |
| Prueba (ficticio)    | F1   | [prueba.md](prueba.md) |
| Onboarding           | F3   | Pendiente              |
| Prospección BRAIN    | F5   | Pendiente              |
| Coordinador          | F6   | Pendiente              |
| Emailing             | F7   | Pendiente              |
| Pantalla LinkedIn    | F8   | Pendiente              |
| Llamadas             | F9   | Pendiente              |
| Cierre → Facturación | F10  | Pendiente              |
| Upsales + CS         | F11  | Pendiente              |
| Generador de Opinión | F12  | Pendiente              |
| Copiloto SALES OS    | F2B  | Pendiente              |

El catálogo de gates de seguridad del sistema antiguo (ADR 0001) es la semilla
de la sección "problemas frecuentes" de las fichas de prospección y emailing.
