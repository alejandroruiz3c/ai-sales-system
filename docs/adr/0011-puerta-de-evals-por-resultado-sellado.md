# ADR 0011 · Puerta de evals por resultado sellado

- **Estado:** Propuesto
- **Fecha:** 2026-09-25
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F2.7
- **Relacionado:** [ADR 0007](0007-github-personal-gratuito.md)

---

## Contexto

El plan pide «integrar promptfoo en CI con umbral por agente», con el DoD
«PR que empeora un agente falla», y `CLAUDE.md` §1 dice que «un PR que baja la
puntuación de evals de un agente no se fusiona».

Hay tres restricciones que el plan no tenía en cuenta:

1. **GitHub Actions está bloqueado** a nivel de cuenta desde F0. El único check
   que corre en cada PR es el build de Vercel, que ejecuta `pnpm verify`
   ([ADR 0007](0007-github-personal-gratuito.md)).
2. **Ejecutar evals cuesta dinero y necesita la clave del proveedor.** Hacerlo
   en cada build de Vercel pondría la clave en el entorno de build y cobraría
   en cada preview, aunque el PR no toque ningún prompt.
3. **Las evals con modelo no son deterministas.** Un build que a veces falla
   por azar enseña a ignorar el rojo.

## Decisión

**La puerta no ejecuta las evals: comprueba que el último resultado guardado
corresponde a lo que hay en el PR.**

- `pnpm evals` (en `packages/prompts`) ejecuta promptfoo contra el modelo real,
  **a través del mismo router que producción**, y guarda el resultado en
  `packages/prompts/evals/resultados/<plantilla>.json`. El fichero lleva una
  **huella** de todo lo que determina el resultado: plantilla, casos, código
  del evaluador y modelo elegido para su nivel.
- `pnpm verify` (y por tanto el check de Vercel) ejecuta
  `evals/sello.test.ts`, sin red y sin clave. Falla si:
  1. falta el resultado de una plantilla del registro;
  2. la huella no coincide, es decir, alguien cambió el prompt, los casos, el
     evaluador o el modelo y no volvió a evaluar;
  3. la puntuación no llega al umbral de `evals/umbrales.json`;
  4. la puntuación ha bajado respecto a la versión anterior y no hay una
     aceptación expresa (`--acepto-bajada "motivo"`), que queda escrita en el
     propio resultado con el autor. Es la «confirmación expresa» de F2B.7
     trasladada al repositorio.
- promptfoo se ejecuta con `pnpm dlx` y versión fija. No entra en el lockfile
  ni en `pnpm audit`, así que sus 80 dependencias directas no pueden tumbar el
  build.

## Consecuencias

**A favor**

- La regla «un PR que empeora un agente no se fusiona» se cumple con el único
  check que existe hoy, sin coste por build y sin clave en el build.
- El resultado de las evals queda en el diff del PR, caso por caso, al lado del
  cambio de prompt que lo produce. Quien revisa ve las dos cosas juntas.
- La puerta es determinista: rojo significa siempre lo mismo.

**En contra, y asumido**

- **El resultado es un JSON editable.** Alguien podría escribir a mano una
  puntuación. Se ve en el diff del PR y la revisión es obligatoria por norma
  (ADR 0007). Además, la comprobación verifica que aprobados, casos y
  puntuación cuadran. Es el mismo nivel de garantía que el resto de la revisión
  en un plan gratuito, no uno mayor.
- **Hay que acordarse de ejecutar `pnpm evals`.** Si no se hace, el PR queda en
  rojo con el comando exacto en el mensaje. El olvido cuesta un ciclo, no una
  regresión.
- **La huella incluye el modelo.** Cambiar el modelo de un nivel en el catálogo
  obliga a volver a evaluar todas las plantillas de ese nivel. Es lo correcto,
  y cuesta céntimos.

## Alternativas consideradas

1. **Workflow de GitHub Actions con promptfoo en cada PR que toque
   `packages/prompts`.** Es lo que pide el plan, y no puede ejecutarse mientras
   Actions esté bloqueado. Cuando vuelva, un workflow que ejecute `pnpm evals`
   y compare con el sello es un complemento, no un sustituto.
2. **Ejecutar las evals dentro del build de Vercel.** Descartada por coste,
   por la clave en el entorno de build y por no ser determinista.
3. **Solo umbral, sin comparar con la versión anterior.** No cumple
   `CLAUDE.md`: una plantilla que pasa de 100 % a 91 % con umbral 90 empeora y
   se fusionaría.

## Pendiente de decisión de Alex

Aprobar el mecanismo, o pedir la alternativa 1 cuando vuelva Actions.
