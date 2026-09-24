---
'@sales-os/web': minor
'@sales-os/agent-prueba': minor
'@sales-os/db': patch
'@sales-os/scripts': patch
---

Archivos con versiones, credenciales en Vault, configuración versionada, cola de aprobaciones y el agente ficticio de prueba (F1.5–F1.13).

Cierra el panel de F1: subir y reemplazar archivos conservando las versiones anteriores, guardar credenciales cifradas que no vuelven al panel, editar la configuración de un agente con formulario y vista JSON, revertir a una versión anterior, resolver aprobaciones editando antes de aprobar, y el presupuesto con avisos y corte.

El paquete nuevo `@sales-os/agent-prueba` es el agente ficticio que usan los casos T1.7, T1.8 y T1.9: genera una acción inofensiva y decide si la envía según su nivel de autonomía, con un coste fijo de 0,05 € por llamada para que el corte de presupuesto se pueda comprobar con aritmética exacta.
