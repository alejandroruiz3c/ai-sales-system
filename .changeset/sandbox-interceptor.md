---
'@sales-os/integrations': minor
---

Interceptor de modo sandbox (F0.15). Todo adaptador que contacte con una persona
debe envolver el envío con `getSandboxInterceptor().guard(attempt, send)`. El
interceptor falla cerrado y no se puede desactivar fuera de producción.
