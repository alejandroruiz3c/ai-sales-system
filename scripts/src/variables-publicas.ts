/**
 * F0.7 · Ningún secreto en una variable `NEXT_PUBLIC_*`.
 *
 * Next.js sustituye `process.env.NEXT_PUBLIC_X` por su valor **en tiempo de
 * compilación**, dentro del JavaScript que se sirve al navegador. Una variable
 * con ese prefijo no es "una variable de servidor que además se ve en el
 * cliente": es contenido público, indexable, y que queda cacheado en el CDN.
 *
 * Esta comprobación existe por un incidente real, el 2026-09-18:
 * `NEXT_PUBLIC_SENTRY_DSN` contenía un token personal de Sentry (`sntryu_…`) en
 * lugar de un DSN, y se estuvo sirviendo en el bundle público de
 * `staging.sales.turbineh.com`. El DSN de Sentry **sí** es público por diseño; un
 * token de usuario no, y los dos empiezan por «sntr». Ninguna revisión humana
 * distingue eso de un vistazo, y una comprobación automática sí.
 *
 * Corre dentro de `pnpm verify`, o sea también dentro del build de Vercel, que
 * es el único sitio donde las variables de verdad están presentes.
 *
 * Y hay una segunda mitad, `analizarBundle`, que mira el resultado en vez de la
 * causa: rastrea el JavaScript ya construido buscando secretos. Comprobar las
 * variables no basta, porque un secreto puede llegar al cliente por otros
 * caminos —un literal en un componente, una respuesta de API serializada en el
 * HTML, una dependencia que imprime su configuración—. Esa comprobación corre
 * **después** de `next build` (`pnpm verify:bundle`), y por eso está enganchada
 * en el `buildCommand` de Vercel detrás del build.
 */

/** Prefijos que solo tienen los secretos. Si aparece uno, no hay discusión. */
const PREFIJOS_DE_SECRETO: readonly string[] = [
  'sk-',
  'sk_live_',
  'rk_live_',
  'whsec_',
  'xoxb-',
  'xoxp-',
  'ghp_',
  'gho_',
  'ghs_',
  'github_pat_',
  'sntrys_',
  'sntryu_',
  'sbp_',
  'sb_secret_',
  'signkey-',
  'lin_api_',
  'shpat_',
];

/** Nombres que anuncian un secreto por sí solos. */
const NOMBRES_SOSPECHOSOS = /(SECRET|_TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|SIGNING_KEY|SERVICE_ROLE)/;

/**
 * Variables `NEXT_PUBLIC_*` que son públicas de verdad y por diseño. Todo lo
 * demás con ese prefijo se revisa; añadir algo aquí es una decisión de PR.
 */
const PUBLICAS_LEGITIMAS: readonly string[] = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_PUBLIC_SUPABASE_URL',
  // La clave anónima de Supabase es pública por diseño: lo que protege los
  // datos es RLS, no el secreto de esta clave (ADR 0003). Aun así se comprueba
  // que su rol sea `anon`, porque la `service_role` tiene la misma forma.
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
];

export interface HallazgoPublico {
  readonly variable: string;
  readonly motivo: string;
  readonly comoArreglarlo: string;
}

/** El `role` de un JWT, si lo tiene y se puede leer sin verificar la firma. */
export function rolDeJwt(valor: string): string | undefined {
  const partes = valor.split('.');
  if (partes.length !== 3) return undefined;
  const cuerpo = partes[1];
  if (cuerpo === undefined) return undefined;
  try {
    const relleno = cuerpo.padEnd(cuerpo.length + ((4 - (cuerpo.length % 4)) % 4), '=');
    const json: unknown = JSON.parse(
      Buffer.from(relleno.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    if (typeof json !== 'object' || json === null) return undefined;
    const rol = (json as Record<string, unknown>)['role'];
    return typeof rol === 'string' ? rol : undefined;
  } catch {
    return undefined;
  }
}

/** Un DSN de Sentry es `https://<clave>@<host>/<idProyecto>`. */
export function esDsnDeSentry(valor: string): boolean {
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username === '') return false;
    return /^\/\d+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function analizar(entorno: Readonly<Record<string, string | undefined>>): HallazgoPublico[] {
  const hallazgos: HallazgoPublico[] = [];

  for (const [variable, valor] of Object.entries(entorno)) {
    if (!variable.startsWith('NEXT_PUBLIC_')) continue;
    if (valor === undefined || valor.trim() === '') continue;
    const limpio = valor.trim();

    const prefijo = PREFIJOS_DE_SECRETO.find((p) => limpio.startsWith(p));
    if (prefijo !== undefined) {
      hallazgos.push({
        variable,
        motivo: `Su valor empieza por «${prefijo}», que es el prefijo de un secreto.`,
        comoArreglarlo:
          `Quita la variable de Vercel, rota el secreto —ya se ha servido en el navegador— y, ` +
          `si el valor hace falta en servidor, ponlo en una variable sin el prefijo NEXT_PUBLIC_.`,
      });
      continue;
    }

    const rol = rolDeJwt(limpio);
    if (rol !== undefined && rol !== 'anon') {
      hallazgos.push({
        variable,
        motivo: `Contiene un JWT con «role: ${rol}». Solo el rol «anon» puede ser público.`,
        comoArreglarlo:
          'Sustitúyelo por la clave anónima y rota la que se haya publicado. Una service_role ' +
          'en el navegador se salta todas las políticas RLS (ADR 0003).',
      });
      continue;
    }

    if (!PUBLICAS_LEGITIMAS.includes(variable) && NOMBRES_SOSPECHOSOS.test(variable)) {
      hallazgos.push({
        variable,
        motivo: 'Su nombre anuncia un secreto y lleva el prefijo NEXT_PUBLIC_.',
        comoArreglarlo:
          'Si de verdad es público, añádelo a PUBLICAS_LEGITIMAS en este fichero, con su motivo ' +
          'y revisado en el PR. Si no, quítale el prefijo NEXT_PUBLIC_.',
      });
      continue;
    }

    if (variable === 'NEXT_PUBLIC_SENTRY_DSN' && !esDsnDeSentry(limpio)) {
      hallazgos.push({
        variable,
        motivo: 'No tiene la forma de un DSN de Sentry (https://<clave>@<host>/<idProyecto>).',
        comoArreglarlo:
          'Cógelo de Sentry → Settings → Projects → tu proyecto → Client Keys (DSN). Un token ' +
          'de organización o de usuario no sirve, y además no puede ser público.',
      });
    }
  }

  return hallazgos.sort((a, b) => a.variable.localeCompare(b.variable));
}

/**
 * Lo que nunca puede aparecer en el JavaScript que se sirve al navegador.
 *
 * Se comprueba sobre el resultado construido, no sobre las variables, porque es
 * el único sitio donde se ve la verdad: lo que el usuario descarga.
 */
const PATRONES_EN_BUNDLE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  {
    nombre: 'token con prefijo de secreto',
    patron: new RegExp(
      `(?:${PREFIJOS_DE_SECRETO.map((p) => p.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})[A-Za-z0-9_-]{8,}`,
      'g',
    ),
  },
  {
    nombre: 'host de ingesta de Better Stack',
    // El host no es un secreto por sí mismo, pero no tiene ninguna razón para
    // estar en el cliente: los logs se envían desde el servidor. Si aparece, es
    // que alguien ha movido el logger a un componente de cliente, y el token va
    // detrás.
    patron: /\bs\d{6,}\.[a-z0-9-]+\.betterstackdata\.com/g,
  },
];

export interface FicheroConstruido {
  readonly ruta: string;
  readonly contenido: string;
}

/**
 * Busca secretos en el JavaScript ya construido.
 *
 * El DSN de Sentry **sí** tiene que estar ahí: es público por diseño y sin él el
 * navegador no reporta errores. Lo que no puede estar es un token.
 */
export function analizarBundle(ficheros: readonly FicheroConstruido[]): HallazgoPublico[] {
  const hallazgos: HallazgoPublico[] = [];

  for (const fichero of ficheros) {
    for (const { nombre, patron } of PATRONES_EN_BUNDLE) {
      const coincidencias = [...fichero.contenido.matchAll(patron)];
      if (coincidencias.length === 0) continue;
      hallazgos.push({
        variable: fichero.ruta,
        motivo: `El JavaScript servido al navegador contiene un ${nombre} (${String(coincidencias.length)} aparición/es).`,
        comoArreglarlo:
          'Da el secreto por comprometido y rótalo: este fichero se sirve en público y el CDN ' +
          'lo conserva. Después busca por dónde llegó — una variable NEXT_PUBLIC_, un literal en ' +
          'un componente de cliente, o datos de servidor serializados en el HTML.',
      });
    }

    // Un JWT en el cliente solo puede ser la clave anónima de Supabase.
    for (const jwt of fichero.contenido.matchAll(
      /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g,
    )) {
      const cuerpo = jwt[1];
      if (cuerpo === undefined) continue;
      const rol = rolDeJwt(`x.${cuerpo}.y`);
      if (rol === undefined || rol === 'anon') continue;
      hallazgos.push({
        variable: fichero.ruta,
        motivo: `El JavaScript servido al navegador contiene un JWT con «role: ${rol}».`,
        comoArreglarlo:
          'Rota esa clave ya: en el navegador se salta todas las políticas RLS (ADR 0003). ' +
          'Solo el rol «anon» puede llegar al cliente.',
      });
    }
  }

  return hallazgos;
}

export function formatearInformeDeBundle(
  hallazgos: readonly HallazgoPublico[],
  ficheros: number,
  bytes: number,
): string {
  const tamano = `${String(Math.round(bytes / 1024))} KB`;
  if (hallazgos.length === 0) {
    return `✔ Bundle limpio: ${String(ficheros)} fichero(s) servidos al navegador (${tamano}), ningún secreto.\n`;
  }
  const lineas: string[] = [
    `✖ Hay ${String(hallazgos.length)} secreto(s) en el JavaScript que se sirve al navegador.`,
    '',
    '  Esto no es un riesgo teórico: el fichero es público, lo sirve el CDN y lo',
    '  conserva. Da el secreto por filtrado y rótalo antes de arreglar el código.',
    '',
  ];
  for (const hallazgo of hallazgos) {
    lineas.push(`  ${hallazgo.variable}`);
    lineas.push(`      ${hallazgo.motivo}`);
    lineas.push(`      → ${hallazgo.comoArreglarlo}`);
    lineas.push('');
  }
  return lineas.join('\n');
}

export function formatearInforme(hallazgos: readonly HallazgoPublico[], revisadas: number): string {
  if (hallazgos.length === 0) {
    return `✔ Variables públicas: ${String(revisadas)} NEXT_PUBLIC_* revisadas, ningún secreto.\n`;
  }

  const lineas: string[] = [
    `✖ Hay ${String(hallazgos.length)} variable(s) NEXT_PUBLIC_* con pinta de secreto.`,
    '',
    '  Next.js incrusta estas variables en el JavaScript que sirve al navegador,',
    '  así que su valor es público: cualquiera que abra la página lo puede leer, y',
    '  el CDN lo conserva.',
    '',
  ];
  for (const hallazgo of hallazgos) {
    lineas.push(`  ${hallazgo.variable}`);
    lineas.push(`      ${hallazgo.motivo}`);
    lineas.push(`      → ${hallazgo.comoArreglarlo}`);
    lineas.push('');
  }
  return lineas.join('\n');
}
