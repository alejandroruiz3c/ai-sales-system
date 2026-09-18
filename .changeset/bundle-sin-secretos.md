---
'@sales-os/core': minor
'@sales-os/scripts': minor
---

`pnpm variables-publicas` gana un segundo modo, `--bundle <carpeta>`, que
rastrea el JavaScript, los mapas de fuentes y el HTML **ya construidos** buscando
secretos: prefijos de token conocidos, JWT con `role` distinto de `anon` y el
host de ingesta de Better Stack. Se engancha detrás de `next build` como
`pnpm verify:bundle`, dentro del `buildCommand` de Vercel, así que un secreto en
el bundle **rompe el despliegue**.

Existe por el incidente del 2026-09-18: un token de Sentry acabó servido en el
JavaScript público de staging. Revisar las variables de entorno no basta, porque
un secreto puede llegar al cliente por otros caminos; lo único que ve la verdad
es lo que el navegador descarga.
