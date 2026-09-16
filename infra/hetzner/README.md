# Plano de ejecución · Hetzner

Aquí vive todo lo que Vercel no puede ejecutar: navegador persistente, IP
estable y procesos largos (LinkedIn, generador de opinión, crawling pesado).

- `docker-compose.yml` — se añade en **F14.1**
- Provisión, cortafuegos y copias — **F14.1**
- Proxies ISP con IP estática por cuenta de LinkedIn — **F8.3**

Por qué no en Vercel: una función serverless no mantiene viva una sesión de
navegador de LinkedIn ni sale siempre por la misma IP. Forzarlo restringe
cuentas (plan §7, riesgos 1 y 7).
