# Scripts de operación del repositorio

Lo que no se puede dejar hecho en un fichero del repositorio, porque son ajustes
de GitHub o de un proveedor, queda aquí como un comando reproducible.

| Script             | Qué hace                                                                                                            | Tarea | Requiere                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------- |
| `seed-github.mjs`  | Crea etiquetas, un hito por fase y las 204 tareas del plan como issues                                              | F0.13 | `gh` autenticado con escritura      |
| `proteger-main.sh` | Protege `main`, exige CI y revisión de CODEOWNERS, activa secret scanning y push protection, deja solo squash merge | F0.7  | `gh` autenticado como administrador |
| `backlog.json`     | Las 204 tareas atómicas extraídas del plan. Es el dato que consume `seed-github.mjs`                                | —     | —                                   |

```bash
node scripts/seed-github.mjs --dry-run     # ver qué haría, sin escribir
node scripts/seed-github.mjs               # crear todo
node scripts/seed-github.mjs --fase F1     # solo una fase
./scripts/proteger-main.sh
```

`seed-github.mjs` es idempotente: no duplica un issue cuyo título ya existe, así
que se puede volver a ejecutar cuando el plan crezca.
