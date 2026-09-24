import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes del workspace se consumen como TypeScript, sin paso de build.
  transpilePackages: ['@sales-os/core', '@sales-os/integrations', '@sales-os/db'],
  typedRoutes: true,
  /**
   * Next 16 genera por su cuenta un `AGENTS.md` y un `CLAUDE.md` en `apps/web`
   * con sus propios consejos. Aquí se desactiva, y no por desconfianza del
   * contenido:
   *
   * `CLAUDE.md` de la raíz **es** el reglamento del proyecto, y su primera
   * línea dice que ese fichero manda. Un segundo `CLAUDE.md` que una
   * herramienta regenera en cada arranque, dentro de una carpeta, es una
   * segunda fuente de instrucciones que nadie ha revisado y que gana por
   * proximidad en cualquier herramienta que resuelva por cercanía. El informe
   * de F0 ya anota como limitación que `CLAUDE.md` y `AGENTS.md` son dos copias
   * de lo mismo; cuatro copias, dos de ellas automáticas, es peor.
   */
  agentRules: false,
  // Cabeceras mínimas. La política completa llega con F13.
  headers() {
    return Promise.resolve([
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]);
  },
};

export default nextConfig;
