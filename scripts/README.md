# Scripts de operación del repositorio

Lo que no se puede dejar hecho en un fichero del repositorio, porque son ajustes
de GitHub o de un proveedor, queda aquí como un comando reproducible.

| Script                     | Qué hace                                                                                                            | Tarea | Requiere                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------- |
| `src/sistema-vacio-cli.ts` | Falla si hay un dato de negocio real en el repositorio. Obligatorio en CI                                           | F0.19 | nada                                |
| `terminos-vetados.json`    | La lista de términos vetados y sus excepciones, cada una con su motivo                                              | F0.19 | —                                   |
| `seed-github.mjs`          | Crea etiquetas, un hito por fase y las 204 tareas del plan como issues                                              | F0.13 | `gh` autenticado con escritura      |
| `proteger-main.sh`         | Protege `main`, exige CI y revisión de CODEOWNERS, activa secret scanning y push protection, deja solo squash merge | F0.7  | `gh` autenticado como administrador |
| `backlog.json`             | Las 204 tareas atómicas extraídas del plan. Es el dato que consume `seed-github.mjs`                                | —     | —                                   |

```bash
pnpm sistema-vacio                         # F0.19: ¿hay algún dato de negocio real?
pnpm sistema-vacio --ruta packages         # solo una subcarpeta
pnpm sistema-vacio --json                  # salida para máquinas

node scripts/seed-github.mjs --dry-run     # ver qué haría, sin escribir
node scripts/seed-github.mjs               # crear todo
node scripts/seed-github.mjs --fase F1     # solo una fase
./scripts/proteger-main.sh
```

`seed-github.mjs` es idempotente: no duplica un issue cuyo título ya existe, así
que se puede volver a ejecutar cuando el plan crezca.

## La comprobación de sistema vacío (F0.19)

`pnpm sistema-vacio` recorre los ficheros versionados **y los nuevos que no
estén ignorados** —un fixture recién creado y sin `git add` falla igual— y hace
dos comprobaciones:

1. **Términos vetados.** Una lista cerrada de nombres, productos y precios reales
   que ya estuvieron en el repositorio o que vienen del sistema antiguo. Detecta
   la reincidencia.
2. **Datos de prueba sin marcar.** Un fichero en `fixtures/`, `seeds/` o `evals/`
   que hable de precios, ICP, ofertas o argumentarios tiene que declarar
   `CORPORATE FICTICIO` dentro del propio fichero. Detecta lo nuevo, porque el
   camino por el que un dato real entraría es "lo pongo como fixture, que es solo
   un test".

La lista es dato (`terminos-vetados.json`), no código, y cada regla y cada
excepción lleva su motivo escrito: quien vea fallar el check tiene que entender
por qué sin preguntar a nadie. Si un hallazgo es legítimo, **no se silencia en el
código**: se añade la excepción con su motivo y se revisa en el PR como cualquier
otro cambio.

La lógica vive en `src/sistema-vacio.ts` y tiene tests
(`pnpm --filter @sales-os/scripts test`).
