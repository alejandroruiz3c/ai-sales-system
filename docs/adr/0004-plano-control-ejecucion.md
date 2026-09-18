# ADR 0004 · Plano de control en Vercel, plano de ejecución en Hetzner

- **Estado:** Aceptado
- **Fecha:** 2026-09-16 · **Aceptado:** 2026-09-18
- **Decide:** Alejandro Ruiz
- **Autor:** Claude Code
- **Tarea del plan:** F0.12

---

## Contexto

La dirección del proyecto pidió el sistema "desplegado en Vercel". Hay tres
cosas que Vercel no puede hacer, y no por configuración sino por diseño:

1. **Mantener viva una sesión de navegador.** Una función serverless arranca,
   responde y muere. LinkedIn necesita un Chromium con perfil persistente que
   siga abierto entre acciones.
2. **Salir siempre por la misma IP.** Las IP de salida de una plataforma
   serverless rotan. Una cuenta de LinkedIn que aparece cada día desde un país
   distinto se restringe.
3. **Procesos largos.** Un crawling completo de una web corporativa o un lote
   de navegación no encaja en el presupuesto de una función.

Forzar esas tres cosas en Vercel no da un sistema lento: da cuentas de LinkedIn
restringidas, incluidas las personales del equipo (plan §7, riesgos 1 y 7).

## Decisión

**El sistema se parte en dos planos.**

**Plano de control — Vercel.** Panel Next.js multi-tenant, API, webhooks
(Pipedrive, Stripe, Calendly, voz, email, WhatsApp) y las funciones de Inngest
que orquestan. Es lo que Alex abre en el navegador y lo que recibe los eventos
del mundo exterior.

**Plano de ejecución — Hetzner.** Workers en Docker con Playwright: un
directorio de perfil de Chromium por cuenta, cifrado en reposo, y una IP estática
por cuenta vía proxy ISP. Aquí corre el agente de pantalla de LinkedIn, la
lectura de LinkedIn del generador de opinión y el crawling pesado.

**Cómo se hablan.** Solo por eventos de Inngest. El orquestador publica un
trabajo con su tenant y su máquina; el worker lo recoge con el SDK de Inngest,
lo ejecuta y devuelve el resultado como otro evento. El worker **no** expone una
API pública, **no** consulta la base de datos en nombre de un usuario y **no**
guarda credenciales de tenant: recibe lo que necesita para el trabajo concreto.

**Regla de reparto.** Si algo necesita navegador con sesión, IP fija o más de un
minuto de CPU, va al worker. Todo lo demás, a Vercel. En caso de duda, a Vercel:
es donde el despliegue es automático y la observabilidad, gratis.

## Consecuencias

**A favor**

- El riesgo de restricción de cuentas se reduce a lo que es reducible: cada
  cuenta la conecta su titular, sale siempre por su IP y se comporta como un
  humano.
- El panel se despliega en cada PR con preview, sin pensar en infraestructura.
- El coste de los workers es de servidor, no de función: un crawling largo no
  dispara la factura.

**En contra, y asumido**

- **Dos entornos que operar**, con dos formas de despliegue (Vercel automático,
  Docker con etiqueta de versión y aprobación manual a producción).
- **El worker es una pieza con estado**: los perfiles de navegador son datos que
  hay que respaldar y cifrar, y una máquina caída deja un canal parado. Se
  mitiga con alertas (F14.8) y un runbook (F8.16).
- **Latencia y fallos de red entre planos.** Inngest absorbe esto con
  reintentos: un trabajo que no llega al worker se reintenta, no se pierde.
- **La promesa "todo en Vercel" no se cumple literalmente.** Es lo correcto:
  cumplirla al pie de la letra costaría las cuentas de LinkedIn del equipo.

## Alternativas consideradas

1. **Todo en Vercel, usando la API oficial de LinkedIn.** La API oficial no
   permite enviar invitaciones ni mensajes de prospección: no existe el producto
   que haría falta. No es una alternativa, es otro sistema.
2. **Todo en Vercel con un servicio de navegador gestionado** (Browserless,
   Browserbase y similares). Resuelve el navegador, no la IP estable por cuenta
   ni el perfil persistente a largo plazo, y añade coste por minuto. Se reserva
   como respaldo puntual si una web bloquea el crawler propio.
3. **Todo en Hetzner, incluido el panel.** Más barato y se pierden las previews
   por PR, el HTTPS gestionado y el despliegue automático, que es justo lo que
   hace que varios equipos puedan trabajar en paralelo.
4. **Otro proveedor de servidores** (Fly, Railway, Scaleway). Hetzner se elige
   porque ya hay experiencia operando agentes ahí y porque el coste por RAM es
   el más bajo del grupo; la RAM es el recurso que limita cuántos perfiles de
   navegador caben (§2.7 del plan).

## Decisión de Alex (2026-09-18)

**Aceptado.** Hetzner como plano de ejecución, con dos precisiones:

1. **Las IP de datacenter quedan descartadas para LinkedIn.** No es una
   preferencia: LinkedIn las detecta y el resultado es la cuenta restringida, que
   es el riesgo 1 del plan (§7). El tráfico de LinkedIn sale **solo** por proxies
   ISP con IP estática y residencial/ISP, una por cuenta operada.
2. **El proveedor de proxies se decide al inicio de F8, después de una prueba
   real**, no ahora y no sobre el papel. La prueba tiene que medir, con una
   cuenta de prueba y durante varios días: estabilidad de la IP (que no rote),
   geolocalización coherente con la cuenta, latencia, y comportamiento ante la
   verificación de LinkedIn. Se elige con esos datos y se escribe en el ADR que
   sustituya a este.

Hasta esa prueba, **no se operan cuentas de LinkedIn reales**, ni las personales
del equipo. El worker de navegador se desarrolla contra cuentas de prueba y con
el interceptor de sandbox activo.
