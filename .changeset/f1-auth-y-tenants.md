---
'@sales-os/web': minor
'@sales-os/db': patch
---

Auth, corporates, invitaciones y cambio de corporate (F1.3, F1.4).

El panel entra en escena: primer arranque sin nadie dado de alta, login, invitaciones por enlace con el token guardado solo como sha256, selector de corporate y panel de inicio con el embudo y el coste por lead, reunión y cierre.

En `@sales-os/db`, el cargador de migraciones pasa a su propia entrada (`@sales-os/db/migraciones`) para que el panel no pueda arrastrar código que lee del disco, y el contexto de consulta expone `consultar`/`unaFila` además del ORM.
