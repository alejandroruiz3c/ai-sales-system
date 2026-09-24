---
'@sales-os/scripts': minor
'@sales-os/db': patch
---

`pnpm sistema-vacio` falla si algún script referencia el fichero de claves.

La regla permanente 4 pasa de «se lee con cuidado» a «no se lee»: está prohibido ejecutar cualquier comando o script que lea, filtre, transforme o liste su contenido, tampoco para mostrar «solo los nombres» ni valores enmascarados. La comprobación nueva lo hace mecánico y cubre scripts, `package.json`, hooks de git y la lista de permisos preaprobados de `.claude/`, que es el caso peor porque convierte el comando prohibido en uno que se ejecuta sin preguntar.
