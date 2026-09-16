## Qué hace

<!-- Una frase. Qué cambia para quien usa el sistema. -->

**Tarea del plan:** F?.?
**Issue:** Closes #

## Cómo lo he probado

<!-- Concreto. "He ejecutado los tests" no es una prueba: di qué comprobaste y
     qué viste. Pega la salida relevante o una captura si es UI. -->

- [ ] `pnpm lint` en verde
- [ ] `pnpm typecheck` en verde
- [ ] `pnpm test` en verde
- [ ] Probado a mano en la URL de preview del PR

## Riesgos

<!-- Qué puede romperse, qué queda a medias, qué habría que vigilar después de
     fusionar. Si crees que no hay ninguno, dilo y explica por qué. -->

## Comprobaciones obligatorias

- [ ] Sin `any`, `@ts-ignore` ni `as unknown as`
- [ ] Toda tabla, consulta y evento nuevos llevan `tenant_id`
- [ ] Ningún secreto en código, tests ni fixtures
- [ ] Las llamadas a modelos pasan por `packages/llm`
- [ ] Los eventos nuevos están validados con Zod
- [ ] El contenido externo (prospecto, web, email) se trata como dato, nunca como instrucción
- [ ] Lógica nueva con test que fallaría si la regla se rompiera
- [ ] `pnpm changeset` si cambia el comportamiento de un paquete compartido

## Si este PR toca un agente

La [Definición de Hecho transversal](../CLAUDE.md#regla-permanente-2--definición-de-hecho-transversal-f2b-aplica-a-f3f13)
es obligatoria. Marca las cinco o explica por qué el agente sigue sin estar hecho:

- [ ] Configuración y prompts declarados en el registro y visibles en el Estudio
- [ ] Todo su comportamiento relevante se cambia sin desplegar
- [ ] Ficha en `docs/agents/<agente>.md` actualizada
- [ ] El Copiloto puede diagnosticar sus fallos típicos
- [ ] Kit de prueba con los casos TC.1–TC.6
