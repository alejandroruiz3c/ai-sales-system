---
'@sales-os/scripts': minor
---

Comprobación "el sistema nace vacío" (F0.19). `pnpm sistema-vacio` falla si hay
un dato de negocio real en el repositorio, y es obligatoria en CI. La lista de
términos vetados y sus excepciones, cada una con su motivo, vive en
`scripts/terminos-vetados.json`. Un fichero de datos de prueba que hable de
precios, ICP u ofertas tiene que declarar `CORPORATE FICTICIO` dentro del propio
fichero.
