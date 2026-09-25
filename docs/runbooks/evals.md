# Runbook · Evals de plantillas y la puerta del sello

**Cuándo se usa:** cuando un PR queda en rojo con un mensaje de
`evals/sello.test.ts`, o cuando cambias una plantilla de `packages/prompts`.

Decisión de fondo: [ADR 0011](../adr/0011-puerta-de-evals-por-resultado-sellado.md).

## Qué comprueba la puerta

En cada PR, `pnpm verify` comprueba sin red que el resultado guardado en
`packages/prompts/evals/resultados/<plantilla>.json`:

1. existe;
2. corresponde a la plantilla, los casos, el evaluador y el modelo actuales
   (huella);
3. llega al umbral de `evals/umbrales.json`;
4. no baja respecto a la versión anterior sin aceptación expresa.

## Los cuatro mensajes y qué hacer

| Mensaje                                         | Qué pasa                                    | Qué hacer                                                                      |
| ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| «no tiene resultado de evals»                   | Plantilla nueva sin evaluar                 | `pnpm --filter @sales-os/prompts evals <id>` y subir el JSON                   |
| «han cambiado desde la última eval»             | Cambiaste prompt, casos, evaluador o modelo | Lo mismo. Revisa en el diff del JSON qué casos cambian                         |
| «puntúa X y su umbral es Y»                     | La plantilla es peor que el mínimo          | Arreglar la plantilla. Bajar el umbral es un cambio que se defiende en el PR   |
| «baja de X a Y. Una bajada necesita aceptación» | Empeora respecto a la versión anterior      | Arreglarla, o `pnpm evals <id> --acepto-bajada "motivo"` si la bajada compensa |

## Ejecutarlas

```bash
vercel env pull apps/web/.env.local --environment development   # trae ANTHROPIC_API_KEY
pnpm --filter @sales-os/prompts evals                  # todas
pnpm --filter @sales-os/prompts evals redactar-email   # una
```

Cuestan céntimos: la primera ejecución completa de F2 costó 0,076 €. Se cobran
a la plataforma, no a ningún tenant, con un tope de 2 € por proceso.

## Problemas frecuentes

- **«Falta ANTHROPIC_API_KEY»:** no hay `apps/web/.env.local` o no tiene la
  clave. Se trae con `vercel env pull`. En Development no es sensible
  precisamente para esto.
- **Un caso de email suspende por el juez y el email parece bueno:** lee el
  motivo en el JSON. Si el juez castiga algo que el perfil permite, el fallo
  está en la rúbrica (`evals/casos.ts`), no en la plantilla. Cambiar la
  rúbrica cambia la huella y obliga a volver a evaluar, que es lo correcto.
- **Resultados distintos entre dos ejecuciones:** las evals con modelo no son
  deterministas. Si un caso oscila, el caso es ambiguo: hay que mejorarlo, no
  repetir hasta que salga verde.
