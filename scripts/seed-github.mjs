#!/usr/bin/env node
/**
 * Puebla GitHub con el plan: etiquetas, hitos por fase e issues (F0.13).
 *
 * Lee `scripts/backlog.json`, que se genera del plan y contiene las 204 tareas
 * atómicas de F0 a F14. Cada tarea es un issue, como pide el plan (§4).
 *
 * Requiere el CLI `gh` autenticado con permiso de escritura en el repositorio.
 *
 *   node scripts/seed-github.mjs --dry-run        # enseña qué haría
 *   node scripts/seed-github.mjs                  # lo hace
 *   node scripts/seed-github.mjs --fase F1        # solo una fase
 *
 * Es idempotente: si un issue con el mismo título ya existe, no lo duplica.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

const REPO = process.env.SALES_OS_REPO ?? 'alejandroruiz3c/ai-sales-system';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const soloFase = args.includes('--fase') ? args[args.indexOf('--fase') + 1] : null;

const ETIQUETAS = [
  ['bug', 'd73a4a', 'Algo no hace lo que debería'],
  ['feature', '0e8a16', 'Capacidad nueva o cambio de comportamiento'],
  ['agent', '5319e7', 'Afecta a un agente del sistema'],
  ['triage', 'fbca04', 'Pendiente de clasificar'],
  ['seguridad', 'b60205', 'Aislamiento entre tenants, secretos o inyección'],
  ['coste', 'c5def5', 'Presupuesto, router de modelos o capacidad'],
  ['legal', 'e99695', 'Consentimiento, aviso de IA, condiciones de plataforma'],
  ['bloqueado', '000000', 'Espera algo externo: una cuenta, una clave o una aprobación'],
  ['prioridad:alta', 'b60205', 'Ruta crítica'],
  ['prioridad:media', 'fbca04', ''],
  ['prioridad:baja', 'c2e0c6', ''],
];

const AGENTES = [
  'onboarding',
  'prospeccion',
  'coordinador',
  'emailing',
  'linkedin',
  'llamadas',
  'cierre',
  'cs',
  'opinion',
  'copiloto',
  'estudio',
];

/** Etiqueta de agente a partir del texto de la tarea, cuando se puede inferir. */
function etiquetaAgente(tarea) {
  const texto = `${tarea.titulo} ${tarea.tecnologia}`.toLowerCase();
  const reglas = [
    ['linkedin', 'agente:linkedin'],
    ['voz|llamada|twilio|retell|vapi', 'agente:llamadas'],
    ['buzón|buzon|email|gmail|graph|dmarc', 'agente:emailing'],
    ['pipedrive|crm', 'agente:coordinador'],
    ['copiloto', 'agente:copiloto'],
    ['estudio|prompt', 'agente:estudio'],
    ['onboarding|deck|argumentario|perfil comercial', 'agente:onboarding'],
    ['prospecto|prospección|prospeccion|enriquec|icp|decisor', 'agente:prospeccion'],
    ['stripe|nda|factura|firma', 'agente:cierre'],
    ['upsell|cliente|feedback|campaña', 'agente:cs'],
    ['opinión|opinion|reddit|youtube', 'agente:opinion'],
  ];
  for (const [patron, etiqueta] of reglas) {
    if (new RegExp(patron).test(texto)) return etiqueta;
  }
  return null;
}

async function gh(argv, { allowFail = false } = {}) {
  if (dryRun) {
    console.log(`  [dry-run] gh ${argv.join(' ')}`);
    return '';
  }
  try {
    const { stdout } = await run('gh', argv, { maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    if (allowFail) return '';
    throw error;
  }
}

async function crearEtiquetas() {
  console.log('\n▸ Etiquetas');
  for (const [nombre, color, descripcion] of ETIQUETAS) {
    await gh(
      [
        'label',
        'create',
        nombre,
        '--repo',
        REPO,
        '--color',
        color,
        '--description',
        descripcion,
        '--force',
      ],
      { allowFail: true },
    );
  }
  for (const agente of AGENTES) {
    await gh(
      [
        'label',
        'create',
        `agente:${agente}`,
        '--repo',
        REPO,
        '--color',
        '5319e7',
        '--description',
        `Agente ${agente}`,
        '--force',
      ],
      { allowFail: true },
    );
  }
  console.log(`  ${ETIQUETAS.length + AGENTES.length} etiquetas`);
}

async function crearHitos(fases) {
  console.log('\n▸ Hitos (una fase, un hito)');
  const existentes = dryRun
    ? []
    : JSON.parse(
        (await gh(['api', `repos/${REPO}/milestones?state=all&per_page=100`], {
          allowFail: true,
        })) || '[]',
      );
  const porTitulo = new Map(existentes.map((m) => [m.title, m.number]));

  const hitos = new Map();
  for (const fase of fases) {
    const titulo = `${fase.id} · ${fase.nombre}`;
    if (porTitulo.has(titulo)) {
      hitos.set(fase.id, titulo);
      console.log(`  = ${titulo} (ya existía)`);
      continue;
    }
    await gh(
      [
        'api',
        `repos/${REPO}/milestones`,
        '-f',
        `title=${titulo}`,
        '-f',
        `description=Fase ${fase.id} del plan. No se cierra sin el GO de Alex sobre docs/entregas/${fase.id}.md`,
      ],
      { allowFail: true },
    );
    hitos.set(fase.id, titulo);
    console.log(`  + ${titulo}`);
  }
  return hitos;
}

async function issuesExistentes() {
  if (dryRun) return new Set();
  const salida = await gh(
    ['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '1000', '--json', 'title'],
    { allowFail: true },
  );
  const lista = JSON.parse(salida || '[]');
  return new Set(lista.map((issue) => issue.title));
}

async function crearIssues(tareas, hitos, existentes) {
  console.log('\n▸ Issues');
  let creados = 0;
  let saltados = 0;

  for (const tarea of tareas) {
    const titulo = `${tarea.id} · ${tarea.titulo}`;
    if (existentes.has(titulo)) {
      saltados += 1;
      continue;
    }

    const cuerpo = [
      `**Tarea atómica del plan:** \`${tarea.id}\` (fase ${tarea.fase})`,
      '',
      `**Tecnología:** ${tarea.tecnologia}`,
      '',
      `**Definición de terminado:** ${tarea.dod}`,
      '',
      '---',
      '',
      'Antes de cerrar este issue:',
      '',
      '- [ ] La DoD de arriba se cumple y hay un test que lo demuestra',
      '- [ ] Nada sin `tenant_id`; ningún secreto en el repositorio',
      '- [ ] Si toca un agente, cumple la Definición de Hecho transversal (`CLAUDE.md`, regla permanente 2)',
      '',
      'Contexto: [plan de dirección técnica](../blob/main/docs/plan-sales-os.md) · [reglas permanentes](../blob/main/CLAUDE.md)',
    ].join('\n');

    const etiquetas = ['feature'];
    const agente = etiquetaAgente(tarea);
    if (agente) etiquetas.push(agente);
    if (
      /rls|secreto|vault|aislamiento|inyección|inyeccion|supresión|supresion/i.test(
        `${tarea.titulo} ${tarea.dod}`,
      )
    ) {
      etiquetas.push('seguridad');
    }
    if (/coste|presupuesto|capacidad|límite|limite/i.test(`${tarea.titulo} ${tarea.dod}`)) {
      etiquetas.push('coste');
    }
    if (/legal|consentimiento|aviso de ia|robinson/i.test(`${tarea.titulo} ${tarea.dod}`)) {
      etiquetas.push('legal');
    }

    const argv = ['issue', 'create', '--repo', REPO, '--title', titulo, '--body', cuerpo];
    const hito = hitos.get(tarea.fase);
    if (hito) argv.push('--milestone', hito);
    for (const etiqueta of etiquetas) argv.push('--label', etiqueta);

    await gh(argv, { allowFail: true });
    creados += 1;
    if (creados % 20 === 0) console.log(`  ${creados} creados…`);
  }

  console.log(`  ${creados} creados, ${saltados} ya existían`);
}

async function main() {
  const backlog = JSON.parse(await readFile(new URL('./backlog.json', import.meta.url), 'utf8'));
  const tareas = soloFase
    ? backlog.tareas.filter((tarea) => tarea.fase === soloFase)
    : backlog.tareas;
  const fases = soloFase ? backlog.fases.filter((fase) => fase.id === soloFase) : backlog.fases;

  console.log(`Repositorio: ${REPO}`);
  console.log(`Tareas: ${tareas.length}${soloFase ? ` (solo ${soloFase})` : ''}`);
  if (dryRun) console.log('Modo simulación: no se escribe nada en GitHub.');

  await crearEtiquetas();
  const hitos = await crearHitos(fases);
  await crearIssues(tareas, hitos, await issuesExistentes());

  console.log('\nListo. Crea el tablero en GitHub Projects y añade los issues por hito:');
  console.log(`  gh project create --owner @me --title "SALES OS"`);
  console.log('  (necesita el scope project: gh auth refresh -s project,read:project)');
  console.log('  (después, en el tablero: Add items → filtra por hito y añádelos)');
}

main().catch((error) => {
  console.error('\nHa fallado:', error.message);
  process.exit(1);
});
