**MOTIVO**

| Dato                   | Valor                                                   |
| ---------------------- | ------------------------------------------------------- |
| Commit                 | [`__SHA_CORTO__`](__SERVIDOR__/__REPO__/commit/__SHA__) |
| Autor                  | **AUTOR**                                               |
| Quien hizo el push     | **PUSHER**                                              |
| Ejecución del guardián | [ver log](__EJECUCION__)                                |

**Mensaje del commit**

```
__MENSAJE__
```

---

### Por qué esto es un aviso y no una molestia

En SALES OS nada entra en `main` sin PR (regla permanente 4 de `CLAUDE.md`). No
es burocracia: el repositorio está en un plan gratuito de GitHub, sin protección
de ramas, así que **el check de Vercel sobre el PR es lo único que garantiza que
`main` está desplegable** — ejecuta `pnpm verify` antes de construir
([ADR 0007](../blob/main/docs/adr/0007-github-personal-gratuito.md)). Un commit
que no pasa por un PR no ha pasado por ese check, y por tanto `main` puede estar
roto ahora mismo sin que nadie lo sepa.

### Qué hacer

1. **Comprobar que `main` sigue sano**, sobre este commit:

   ```bash
   git fetch origin && git switch main && git pull
   pnpm install && pnpm verify
   ```

2. **Mirar el despliegue de Vercel** de este commit. Si está en rojo, `main` no
   es desplegable: arréglalo o revierte con `git revert __SHA_CORTO__`, **en una
   rama y con su PR**.
3. **Si el cambio era correcto**, no hay nada que revertir: cierra el issue
   diciendo qué era y por qué se hizo así. Eso deja la excepción documentada.
4. **Si fue un accidente** (un push en la rama equivocada, un `--no-verify` por
   costumbre), comprueba que el hook pre-push está instalado:

   ```bash
   git config core.hooksPath      # tiene que responder .husky/_
   pnpm install                   # lo reinstala si no
   ```
