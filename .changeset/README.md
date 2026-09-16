# Changesets

Versionado de los paquetes de `packages/` (plan §4).

Cuando un PR cambia el comportamiento de un paquete compartido —`@sales-os/core`,
`@sales-os/db`, `@sales-os/llm`, `@sales-os/integrations`…— añade un changeset:

```bash
pnpm changeset
```

Elige los paquetes afectados, el tipo de cambio (patch / minor / major) y escribe
en una frase **qué tiene que hacer quien consume ese paquete**. Ese texto acaba en
el CHANGELOG y es lo que lee el equipo de otro agente cuando algo le deja de
compilar.

Las dos aplicaciones (`@sales-os/web` y `@sales-os/worker-browser`) están en
`ignore`: se despliegan, no se publican, y su versión es el commit desplegado.

Un PR que solo toca documentación, tests o CI no necesita changeset.
