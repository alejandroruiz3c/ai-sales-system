import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes del workspace se consumen como TypeScript, sin paso de build.
  transpilePackages: ['@sales-os/core', '@sales-os/integrations'],
  typedRoutes: true,
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
