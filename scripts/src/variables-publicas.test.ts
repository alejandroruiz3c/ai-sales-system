import { describe, expect, it } from 'vitest';

import { analizar, esDsnDeSentry, rolDeJwt } from './variables-publicas.ts';

/** Ensambla un valor con pinta de secreto sin escribir el literal completo. */
const falso = (prefijo: string, resto: string): string => `${prefijo}${resto}`;

/** JWT sin firmar de verdad, solo con la cabecera y el `role` del cuerpo. */
function jwt(rol: string): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(JSON.stringify({ role: rol, iat: 0 })).toString('base64url');
  return `${cabecera}.${cuerpo}.no-es-una-firma-de-verdad`;
}

function variables(valores: Record<string, string>): readonly string[] {
  return analizar(valores).map((h) => h.variable);
}

describe('rolDeJwt', () => {
  it('lee el rol de un JWT de Supabase', () => {
    expect(rolDeJwt(jwt('anon'))).toBe('anon');
    expect(rolDeJwt(jwt('service_role'))).toBe('service_role');
  });

  it('no se atraganta con lo que no es un JWT', () => {
    for (const valor of ['', 'hola', 'a.b', 'a.b.c', 'https://x.test/1']) {
      expect(rolDeJwt(valor), valor).toBeUndefined();
    }
  });
});

describe('esDsnDeSentry', () => {
  it('acepta un DSN con la forma correcta', () => {
    expect(esDsnDeSentry('https://abc123def456@o1234.ingest.de.sentry.io/7654321')).toBe(true);
  });

  it('rechaza lo que no es un DSN', () => {
    const casos = [
      falso('sntryu', '_abcdefghij1234'), // el incidente del 2026-09-18
      falso('sntrys', '_abcdefghij1234'),
      '[SENTRY_DSN]', // marcador sin rellenar
      'https://o1234.ingest.de.sentry.io/7654321', // sin clave pública
      'https://abc123@o1234.ingest.de.sentry.io', // sin id de proyecto
      'https://abc123@o1234.ingest.de.sentry.io/no-es-un-numero',
      '',
    ];
    for (const caso of casos) {
      expect(esDsnDeSentry(caso), caso).toBe(false);
    }
  });
});

describe('analizar', () => {
  it('caza el incidente real: un token de usuario de Sentry en una variable pública', () => {
    const hallazgos = analizar({
      NEXT_PUBLIC_SENTRY_DSN: falso('sntryu', '_abcdefghij1234'),
    });
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.motivo).toContain('sntryu_');
    expect(hallazgos[0]?.comoArreglarlo).toContain('rota el secreto');
  });

  it('caza una service_role publicada, que se salta RLS', () => {
    const hallazgos = analizar({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') });
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.motivo).toContain('service_role');
  });

  it('caza los prefijos de secreto de los proveedores que usamos', () => {
    expect(
      variables({
        NEXT_PUBLIC_A: falso('sk', '-abcdef123456'),
        NEXT_PUBLIC_B: falso('ghp', '_abcdefghij1234'),
        NEXT_PUBLIC_C: falso('signkey', '-prod-abcdef1234'),
        NEXT_PUBLIC_D: falso('sbp', '_abcdefghij1234'),
        NEXT_PUBLIC_E: falso('whsec', '_abcdefghij1234'),
      }),
    ).toEqual([
      'NEXT_PUBLIC_A',
      'NEXT_PUBLIC_B',
      'NEXT_PUBLIC_C',
      'NEXT_PUBLIC_D',
      'NEXT_PUBLIC_E',
    ]);
  });

  it('caza por el nombre aunque el valor no delate nada', () => {
    expect(variables({ NEXT_PUBLIC_API_SECRET: 'nada-sospechoso-a-la-vista' })).toEqual([
      'NEXT_PUBLIC_API_SECRET',
    ]);
    expect(variables({ NEXT_PUBLIC_SERVICE_ROLE_KEY: 'x'.repeat(40) })).toEqual([
      'NEXT_PUBLIC_SERVICE_ROLE_KEY',
    ]);
  });

  it('caza un DSN que no es un DSN, como el marcador sin rellenar', () => {
    expect(variables({ NEXT_PUBLIC_SENTRY_DSN: '[SENTRY_DSN]' })).toEqual([
      'NEXT_PUBLIC_SENTRY_DSN',
    ]);
  });

  it('deja en paz las variables públicas legítimas, que es lo que evita que se silencie', () => {
    expect(
      analizar({
        NEXT_PUBLIC_APP_URL: 'https://staging.sales.turbineh.com',
        NEXT_PUBLIC_APP_VERSION: '0.0.0+abc1234',
        NEXT_PUBLIC_SUPABASE_URL: 'https://proyecto-ficticio.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
        NEXT_PUBLIC_SENTRY_DSN: 'https://abc123def456@o1234.ingest.de.sentry.io/7654321',
      }),
    ).toEqual([]);
  });

  it('ignora lo que no es NEXT_PUBLIC_, que es donde los secretos sí pueden estar', () => {
    expect(
      analizar({
        SENTRY_DSN: falso('sntryu', '_abcdefghij1234'),
        SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
        LAB_ACCESS_PASSWORD: 'una-contrasena',
      }),
    ).toEqual([]);
  });

  it('ignora las variables vacías, que no publican nada', () => {
    expect(analizar({ NEXT_PUBLIC_SENTRY_DSN: '', NEXT_PUBLIC_OTRA: '   ' })).toEqual([]);
  });
});
