---
'@sales-os/scripts': minor
---

`pnpm sistema-vacio` gana una tercera comprobación: falla si un fichero de
claves (`KEYS.*`, `claves.*`, `.env` salvo `.env.example`, `.pem`, `.key`,
`.p12`, `.pfx`) llega a estar versionado. Mira solo el índice de git, no el
disco: que `KEYS.rtf` exista en la carpeta del proyecto es correcto y
deliberado; lo que no puede es estar en git. Sustituye a la _push protection_ de
GitHub, que no existe en el plan gratuito (ADR 0007).

El informe distingue ahora qué ha fallado, porque un fichero de claves y un
precio real se arreglan de forma distinta.

Nuevo `pnpm e2e:staging`, que lanza los E2E de fase contra staging desde local
mientras GitHub Actions siga bloqueado.
