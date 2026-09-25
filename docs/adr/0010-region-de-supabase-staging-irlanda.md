# ADR 0010 · Supabase de staging en Irlanda (`eu-west-1`)

- **Estado:** Aceptado (2026-09-25)
- **Fecha:** 2026-09-25
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.9
- **Sustituye:** la parte de Supabase de la precisión 1 del [ADR 0002](0002-stack.md)

---

## Contexto

La precisión 1 de la decisión de Alex en el ADR 0002 concreta la región UE así:
«Vercel en `fra1` (Fráncfort) y Supabase en Fráncfort, los dos proyectos». El
informe de F0 dio por hecho que se había cumplido.

Al conectar la base en F1 apareció que no: el pooler del proyecto
`ai-sales-staging` responde en **`eu-west-1` (Irlanda)**. El informe de F1 lo
dejó anotado como algo que había cambiado respecto al plan.

Mover un proyecto de Supabase de región no es un ajuste: es crear otro proyecto
y migrar base, Storage, Vault y usuarios.

## Decisión

**El proyecto de Supabase de staging se queda en Irlanda (`eu-west-1`).**

El requisito que importa del ADR 0002 no cambia: **ningún dato sale de la UE**.
Irlanda es UE, así que el requisito se cumple. Lo que cambia es la ciudad, que
era una concreción de ese requisito y no el requisito en sí.

Vercel sigue en `fra1`. Esa parte de la precisión 1 no se toca.

**Producción (`ai-sales-prod`):** su región **no está verificada**. No se ha
conectado nunca (ADR 0008) y su cadena de conexión solo la tiene Alex. Se
comprueba en F14.3e, antes de aplicarle la primera migración. Tiene que estar
en la UE; si no lo está, se decide entonces, antes de que tenga un solo dato.

## Consecuencias

**A favor**

- Cero trabajo y cero riesgo: no se migra un proyecto que ya tiene esquema,
  políticas y Vault configurados.
- La documentación vuelve a decir lo que hay.

**En contra, y asumido**

- **Funciones en Fráncfort, base en Irlanda.** Cada consulta del panel cruza
  entre las dos regiones: son unos 20–25 ms más de ida y vuelta que con las dos
  en la misma. Hoy no importa. Si la latencia llegara a importar, lo barato es
  mover las funciones de Vercel a `dub1` (Dublín), no la base.

## Alternativas consideradas

1. **Recrear staging en Fráncfort.** Descartada por Alex: el coste de rehacer
   el proyecto no compra nada que el requisito pida.
2. **Mover las funciones de Vercel a `dub1` ya.** No hace falta todavía: no hay
   ninguna medida que diga que la latencia importa.

## Decisión de Alex (2026-09-25)

**Aceptado.** «Supabase staging en Irlanda: correcto. Corrige la documentación
de F0 y del plan; no muevas el proyecto.»
