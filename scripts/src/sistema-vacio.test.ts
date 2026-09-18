import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analizar,
  analizarFichero,
  cargarLista,
  comprobarDatosDePrueba,
  comprobarFicherosDeClaves,
  formatearInforme,
  globARegex,
  neutralizarExcepciones,
  rutaExcluida,
  type ListaVetada,
} from './sistema-vacio.ts';

const lista: ListaVetada = cargarLista(
  JSON.parse(readFileSync(join(import.meta.dirname, '../terminos-vetados.json'), 'utf8')),
);

function analiza(contenido: string, ruta = 'docs/prueba.md'): readonly string[] {
  return analizarFichero({ ruta, contenido }, lista).map((hallazgo) => hallazgo.regla);
}

describe('la lista de términos vetados', () => {
  it('valida contra su esquema y no está vacía', () => {
    expect(lista.reglas.length).toBeGreaterThan(0);
    expect(lista.datosDePrueba.marcador).toBe('CORPORATE FICTICIO');
  });

  it('rechaza una lista con una expresión regular imposible', () => {
    expect(() =>
      cargarLista({
        ...lista,
        reglas: [{ id: 'roto', patron: '(sin cerrar', motivo: 'da igual' }],
      }),
    ).toThrow();
  });

  it('exige motivo en cada regla: quien ve fallar el check tiene que saber por qué', () => {
    expect(() =>
      cargarLista({ ...lista, reglas: [{ id: 'sin-motivo', patron: 'algo', motivo: '' }] }),
    ).toThrow();
  });
});

describe('términos vetados · datos de negocio real', () => {
  it('detecta la entidad real que emite las facturas del sistema antiguo', () => {
    expect(analiza('La factura la emite YESWORKS con su numeración.')).toContain(
      'entidad-emisora-de-facturas',
    );
  });

  it('detecta el producto real, escrito de cualquier manera', () => {
    for (const variante of ['BRAIN OS', 'brain os', 'Brain-OS', 'brain_os']) {
      expect(analiza(`Vendemos ${variante} a asesorías.`)).toContain('producto-real');
    }
  });

  it('detecta los nombres de las unidades de negocio reales', () => {
    expect(analiza('config/ventures/brain-turbineh.yaml')).toContain('unidades-de-negocio-reales');
    expect(analiza('el fixture sale de my-estatia')).toContain('unidades-de-negocio-reales');
    expect(analiza('checktobuild---floor-flatness')).toContain('unidades-de-negocio-reales');
  });

  it('detecta un tenant precargado, que es la forma educada de traer un corporate', () => {
    expect(analiza('Semillas del tenant 0 en producción')).toContain('tenant-precargado');
    expect(analiza('seed del tenant-0')).toContain('tenant-precargado');
  });

  it('detecta los tramos de una tarifa real', () => {
    expect(analiza('La tarifa va de 390 € a 199.000 € al mes.')).toContain(
      'tarifa-real-por-tramos',
    );
    expect(analiza('el YAML dice €900/month')).toContain('precio-mensual-real');
    expect(analiza('manda la tarifa oficial del plan')).toContain('tarifa-propia-de-la-plataforma');
  });

  it('detecta a TurbineH usado como corporate del sistema', () => {
    expect(analiza('Tenant 1: onboarding de TurbineH con su deck')).toContain(
      'turbineh-como-corporate',
    );
    expect(analiza('| Evals con 3 corporates (TurbineH + 2 ficticios)')).toContain(
      'turbineh-como-corporate',
    );
    expect(analiza('Primer tenant: TurbineH vendiendo su producto')).toContain(
      'turbineh-vendiendo',
    );
  });

  it('apunta a la línea exacta del hallazgo', () => {
    const hallazgos = analizarFichero(
      { ruta: 'docs/x.md', contenido: 'primera\nsegunda\nla factura de YESWORKS\n' },
      lista,
    );
    expect(hallazgos[0]?.linea).toBe(3);
  });
});

describe('términos vetados · lo que sí es legítimo', () => {
  it('no se queja del dominio de la plataforma ni de los alias del sandbox', () => {
    expect(analiza('La URL de staging es https://staging.sales.turbineh.com')).toEqual([]);
    expect(analiza('SANDBOX_ALLOWLIST=alex.ruiz+t1@turbineh.com,+34600000000')).toEqual([]);
  });

  it('no se queja del repositorio, la organización ni los equipos de CODEOWNERS', () => {
    expect(analiza('github.com/turbineh/ai-sales-system')).toEqual([]);
    expect(analiza('*  @turbineh/sales-os-platform')).toEqual([]);
    expect(analiza('gh project create --owner turbineh --title "SALES OS"')).toEqual([]);
  });

  it('deja enunciar el propio principio', () => {
    expect(
      analiza(
        'SALES OS no trae ningún corporate, producto, precio ni argumentario precargado, tampoco el de TurbineH. TurbineH solo aporta el dominio, el repositorio y la marca.',
      ),
    ).toEqual([]);
    expect(analiza('Plataforma desarrollada por TurbineH.')).toEqual([]);
  });

  it('no confunde un precio de proveedor de un ADR con un precio de negocio', () => {
    expect(analiza('Signaturit cuesta unos 2 € por firma y Docuseal 0 €.')).toEqual([]);
    expect(analiza('El presupuesto del tenant de prueba se pone en 0,50 €.')).toEqual([]);
  });

  it('una excepción neutraliza sin mover las líneas', () => {
    const neutralizado = neutralizarExcepciones(
      'uno\nstaging.sales.turbineh.com\ntres',
      lista.excepciones,
    );
    expect(neutralizado.split('\n')).toHaveLength(3);
    expect(neutralizado.split('\n')[1]).toMatch(/^ +$/);
  });
});

describe('datos de prueba sin marcar', () => {
  const configuracion = lista.datosDePrueba;

  it('exige el marcador a un fixture que habla de precios', () => {
    const hallazgos = comprobarDatosDePrueba(
      'packages/prompts/src/evals/fixtures/corporate.json',
      '{ "precios": "1.200 € al mes", "icp": "asesorías de 10 a 50 empleados" }',
      configuracion,
    );
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.regla).toBe('datos-de-prueba-sin-marcar');
  });

  it('acepta el mismo fixture cuando declara que el corporate es inventado', () => {
    expect(
      comprobarDatosDePrueba(
        'packages/prompts/src/evals/fixtures/corporate.json',
        '{ "_nota": "CORPORATE FICTICIO", "precios": "1.200 € al mes", "icp": "asesorías" }',
        configuracion,
      ),
    ).toEqual([]);
  });

  it('no molesta a un fixture que no tiene contenido comercial', () => {
    expect(
      comprobarDatosDePrueba(
        'apps/web/e2e/fixtures/usuarios.json',
        '{ "email": "alex.ruiz+lector@ejemplo.test" }',
        configuracion,
      ),
    ).toEqual([]);
  });

  it('solo mira dentro de las carpetas de datos de prueba', () => {
    expect(
      comprobarDatosDePrueba(
        'packages/agents/onboarding/src/index.ts',
        'El ICP y los precios los define el perfil comercial.',
        configuracion,
      ),
    ).toEqual([]);
  });
});

describe('exclusiones y globs', () => {
  it('traduce los globs que usa la lista', () => {
    expect(globARegex('**/fixtures/**').test('packages/db/src/fixtures/a.json')).toBe(true);
    expect(globARegex('**/fixtures/**').test('fixtures/a.json')).toBe(true);
    expect(globARegex('**/fixtures/**').test('packages/db/src/fixturas/a.json')).toBe(false);
    expect(globARegex('packages/db/**/seed*').test('packages/db/src/seeds.ts')).toBe(true);
    expect(globARegex('pnpm-lock.yaml').test('pnpm-lock.yaml')).toBe(true);
  });

  it('excluye lo que declara la lista y nada más', () => {
    expect(rutaExcluida('pnpm-lock.yaml', lista.rutasExcluidas)).toBe(true);
    expect(rutaExcluida('scripts/terminos-vetados.json', lista.rutasExcluidas)).toBe(true);
    expect(rutaExcluida('docs/plan-sales-os.md', lista.rutasExcluidas)).toBe(false);
    expect(rutaExcluida('CLAUDE.md', lista.rutasExcluidas)).toBe(false);
  });

  it('no lee ficheros binarios', () => {
    expect(analiza('YESWORKS', 'docs/deck.pdf')).toEqual([]);
  });
});

describe('informe', () => {
  it('da la ruta, la línea, el término y el motivo', () => {
    const hallazgos = analizar(
      [{ ruta: 'packages/db/src/index.ts', contenido: 'const emisor = "YESWORKS";' }],
      lista,
    );
    const informe = formatearInforme(hallazgos, 1);
    expect(informe).toContain('Hay datos de negocio real');
    expect(informe).toContain('packages/db/src/index.ts:1');
    expect(informe).toContain('YESWORKS');
    expect(informe).toContain('entidad-emisora-de-facturas');
    expect(informe).toContain('sistema envuelto');
  });

  it('cuando no hay nada, lo dice y no alarma', () => {
    expect(formatearInforme([], 42)).toContain('El sistema nace vacío');
  });
});

describe('ficheros de claves versionados', () => {
  function claves(rutas: readonly string[]): readonly string[] {
    return comprobarFicherosDeClaves(rutas).map((hallazgo) => hallazgo.ruta);
  }

  it('falla si KEYS.rtf llega a estar versionado', () => {
    expect(claves(['KEYS.rtf'])).toEqual(['KEYS.rtf']);
  });

  it('falla con cualquier KEYS.*, en la raíz o en una subcarpeta', () => {
    expect(claves(['KEYS', 'KEYS.txt', 'KEYS.rtf', 'docs/KEYS.md', 'infra/vercel/KEYS'])).toEqual([
      'KEYS',
      'KEYS.txt',
      'KEYS.rtf',
      'docs/KEYS.md',
      'infra/vercel/KEYS',
    ]);
  });

  it('falla con claves.*, .env reales, certificados y llaves privadas', () => {
    expect(
      claves([
        'claves.txt',
        '.env',
        '.env.local',
        'apps/web/.env.production',
        'infra/tls/servidor.pem',
        'infra/tls/servidor.key',
        'infra/tls/cliente.p12',
      ]),
    ).toHaveLength(7);
  });

  it('deja pasar .env.example, que no tiene valores y documenta las variables', () => {
    expect(claves(['.env.example', 'apps/web/.env.example'])).toEqual([]);
  });

  it('no confunde un fichero que solo se parece en el nombre', () => {
    expect(
      claves([
        'packages/core/src/keys.ts',
        'docs/runbooks/rotar-claves.md',
        'packages/db/src/monkeys.ts',
        'scripts/src/sistema-vacio.ts',
      ]),
    ).toEqual([]);
  });

  it('el motivo explica cómo sacarlo del índice y que hay que rotar las claves', () => {
    const [hallazgo] = comprobarFicherosDeClaves(['KEYS.rtf']);
    expect(hallazgo?.regla).toBe('fichero-de-claves-versionado');
    expect(hallazgo?.motivo).toContain('git rm --cached KEYS.rtf');
    expect(hallazgo?.motivo).toContain('rótalas');
  });

  it('no falla cuando el repositorio está limpio', () => {
    expect(claves(['package.json', 'docs/plan-sales-os.md', '.env.example'])).toEqual([]);
  });
});

describe('el informe distingue qué ha fallado', () => {
  it('con un fichero de claves habla de claves, no de datos de negocio', () => {
    const informe = formatearInforme(comprobarFicherosDeClaves(['KEYS.rtf']), 1);
    expect(informe).toContain('fichero de claves versionado');
    expect(informe).not.toContain('Hay datos de negocio real');
    // La salida de excepciones solo aplica a términos vetados: aquí no hay
    // excepción legítima posible.
    expect(informe).not.toContain('terminos-vetados.json');
  });

  it('con los dos problemas a la vez, explica los dos', () => {
    const informe = formatearInforme(
      [
        ...comprobarFicherosDeClaves(['.env.local']),
        ...analizar(
          [{ ruta: 'packages/db/src/index.ts', contenido: 'const e = "YESWORKS";' }],
          lista,
        ),
      ],
      2,
    );
    expect(informe).toContain('fichero de claves versionado');
    expect(informe).toContain('Hay datos de negocio real');
  });
});
