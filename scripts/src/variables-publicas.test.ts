import { describe, expect, it } from 'vitest';

import {
  analizar,
  analizarBundle,
  esDsnDeSentry,
  formatearInformeDeBundle,
  rolDeJwt,
} from './variables-publicas.ts';

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

describe('analizarBundle', () => {
  function rutas(ficheros: readonly { ruta: string; contenido: string }[]): readonly string[] {
    return analizarBundle(ficheros).map((h) => h.variable);
  }

  it('caza el incidente real: el token de Sentry servido en el JavaScript público', () => {
    // Lo que de verdad había en el bundle de staging el 2026-09-18, dentro de
    // código minificado como el que sirve Next.js.
    const contenido = `(self.__next_f=[]).push([1,'{"dsn":"${falso('sntryu', '_abcdefghij1234567890')}"}']);`;
    const hallazgos = analizarBundle([{ ruta: 'chunks/main-abc.js', contenido }]);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.motivo).toContain('token con prefijo de secreto');
    expect(hallazgos[0]?.comoArreglarlo).toContain('rótalo');
  });

  it('deja pasar un DSN de Sentry, que tiene que estar en el cliente', () => {
    expect(
      rutas([
        {
          ruta: 'chunks/main-abc.js',
          contenido:
            'Sentry.init({dsn:"https://abc123def4567890@o1234.ingest.de.sentry.io/7654321"})',
        },
      ]),
    ).toEqual([]);
  });

  it('caza una service_role en el cliente y deja pasar la anon', () => {
    const conRol = (rol: string): string => {
      const cab = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
      const cuerpo = Buffer.from(JSON.stringify({ role: rol })).toString('base64url');
      return `${cab}.${cuerpo}.firmafalsa123456789`;
    };
    expect(rutas([{ ruta: 'a.js', contenido: `k="${conRol('service_role')}"` }])).toEqual(['a.js']);
    expect(rutas([{ ruta: 'b.js', contenido: `k="${conRol('anon')}"` }])).toEqual([]);
  });

  it('caza el host de ingesta de Better Stack, que no tiene por qué llegar al cliente', () => {
    expect(
      rutas([
        { ruta: 'c.js', contenido: 'fetch("https://s1234567.eu-nbg-2.betterstackdata.com/")' },
      ]),
    ).toEqual(['c.js']);
  });

  it('no se inventa hallazgos en JavaScript normal', () => {
    expect(
      rutas([
        {
          ruta: 'd.js',
          contenido: 'const a=1;function b(){return "sk"}//# sourceMappingURL=d.js.map',
        },
        { ruta: 'e.js', contenido: 'e.exports={version:"0.0.0+686998a",env:"staging"}' },
      ]),
    ).toEqual([]);
  });

  it('el informe dice el tamaño revisado, para que se vea que ha mirado algo', () => {
    expect(formatearInformeDeBundle([], 8, 802_010)).toContain('8 fichero(s)');
    expect(formatearInformeDeBundle([], 8, 802_010)).toContain('783 KB');
    expect(formatearInformeDeBundle([], 8, 802_010)).toContain('Bundle limpio');
  });
});
