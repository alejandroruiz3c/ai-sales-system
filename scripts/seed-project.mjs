#!/usr/bin/env node
/**
 * Crea el tablero de GitHub Projects y le engancha los issues del plan (F0.13).
 *
 * `seed-github.mjs` crea las etiquetas, los hitos y los 204 issues. Este script
 * hace la otra mitad: el tablero, el campo «Fase» con las épicas F0–F14, y cada
 * issue colocado en su fase.
 *
 *   node scripts/seed-project.mjs --dry-run
 *   node scripts/seed-project.mjs
 *
 * Es idempotente: si el tablero ya existe lo reutiliza, si un issue ya está en
 * el tablero no lo duplica (`addProjectV2ItemById` devuelve el item existente).
 *
 * Necesita el scope `project`:  gh auth refresh -s project,read:project
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const REPO = process.env['SALES_OS_REPO'] ?? 'alejandroruiz3c/ai-sales-system';
const DUENO = REPO.split('/')[0];
const TITULO = 'SALES OS';
const CAMPO_FASE = 'Fase';

/** Las mutaciones se agrupan para no hacer 400 llamadas de una en una. */
const LOTE = 20;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

async function gh(argv) {
  const { stdout } = await run('gh', argv, { maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

async function graphql(consulta, variables = {}) {
  const argv = ['api', 'graphql', '-f', `query=${consulta}`];
  for (const [clave, valor] of Object.entries(variables)) {
    argv.push('-F', `${clave}=${String(valor)}`);
  }
  return JSON.parse(await gh(argv));
}

/** El tablero, creado o reutilizado. */
async function tablero() {
  const existentes = JSON.parse(
    await gh(['project', 'list', '--owner', DUENO, '--format', 'json', '--limit', '50']),
  );
  const ya = existentes.projects?.find((p) => p.title === TITULO);
  if (ya) {
    console.log(`  = tablero «${TITULO}» ya existía (#${String(ya.number)})`);
    return { numero: ya.number, id: ya.id };
  }
  if (dryRun) {
    console.log(`  [dry-run] crearía el tablero «${TITULO}»`);
    return { numero: 0, id: 'DRY_RUN' };
  }
  const creado = JSON.parse(
    await gh(['project', 'create', '--owner', DUENO, '--title', TITULO, '--format', 'json']),
  );
  console.log(`  + tablero «${TITULO}» (#${String(creado.number)})`);
  return { numero: creado.number, id: creado.id };
}

/** El campo «Fase», con una opción por épica, creado o reutilizado. */
async function campoFase(projectId, fases) {
  const datos = await graphql(
    `
      query ($id: ID!) {
        node(id: $id) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
                ... on ProjectV2FieldCommon {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `,
    { id: projectId },
  );
  const campos = datos.data.node.fields.nodes;
  const ya = campos.find((c) => c.name === CAMPO_FASE);
  if (ya?.options) {
    console.log(`  = campo «${CAMPO_FASE}» ya existía (${String(ya.options.length)} opciones)`);
    return { id: ya.id, opciones: new Map(ya.options.map((o) => [o.name, o.id])) };
  }

  const opciones = fases
    .map((f) => `{name: ${JSON.stringify(`${f.id} · ${f.nombre}`)}, color: GRAY, description: ""}`)
    .join(', ');
  const creado = await graphql(
    `mutation {
       createProjectV2Field(input: {
         projectId: ${JSON.stringify(projectId)}
         dataType: SINGLE_SELECT
         name: ${JSON.stringify(CAMPO_FASE)}
         singleSelectOptions: [${opciones}]
       }) {
         projectV2Field {
           ... on ProjectV2SingleSelectField { id name options { id name } }
         }
       }
     }`,
  );
  const campo = creado.data.createProjectV2Field.projectV2Field;
  console.log(`  + campo «${CAMPO_FASE}» con ${String(campo.options.length)} épicas`);
  return { id: campo.id, opciones: new Map(campo.options.map((o) => [o.name, o.id])) };
}

/** El campo Status que trae el tablero por defecto. */
async function campoEstado(projectId) {
  const datos = await graphql(
    `
      query ($id: ID!) {
        node(id: $id) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    `,
    { id: projectId },
  );
  const campo = datos.data.node.fields.nodes.find((c) => c?.name === 'Status');
  if (!campo) return undefined;
  return { id: campo.id, opciones: new Map(campo.options.map((o) => [o.name, o.id])) };
}

async function issues() {
  const lista = JSON.parse(
    await gh([
      'issue',
      'list',
      '--repo',
      REPO,
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'id,number,title',
    ]),
  );
  return lista;
}

function troceado(lista) {
  const trozos = [];
  for (let i = 0; i < lista.length; i += LOTE) trozos.push(lista.slice(i, i + LOTE));
  return trozos;
}

/** Añade los issues al tablero y devuelve el id de item de cada uno. */
async function añadir(projectId, lista) {
  const itemPorIssue = new Map();
  let hechos = 0;
  for (const trozo of troceado(lista)) {
    const mutaciones = trozo
      .map(
        (issue, i) =>
          `a${String(i)}: addProjectV2ItemById(input: {projectId: ${JSON.stringify(projectId)}, contentId: ${JSON.stringify(issue.id)}}) { item { id } }`,
      )
      .join('\n');
    const respuesta = await graphql(`mutation {\n${mutaciones}\n}`);
    trozo.forEach((issue, i) => {
      itemPorIssue.set(issue.number, respuesta.data[`a${String(i)}`].item.id);
    });
    hechos += trozo.length;
    console.log(`  ${String(hechos)}/${String(lista.length)} issues en el tablero`);
  }
  return itemPorIssue;
}

/** Pone el valor de un campo de selección única en muchos items, por lotes. */
async function rellenar(projectId, fieldId, pares, etiqueta) {
  let hechos = 0;
  for (const trozo of troceado(pares)) {
    const mutaciones = trozo
      .map(
        ([itemId, optionId], i) =>
          `u${String(i)}: updateProjectV2ItemFieldValue(input: {projectId: ${JSON.stringify(projectId)}, itemId: ${JSON.stringify(itemId)}, fieldId: ${JSON.stringify(fieldId)}, value: {singleSelectOptionId: ${JSON.stringify(optionId)}}}) { projectV2Item { id } }`,
      )
      .join('\n');
    await graphql(`mutation {\n${mutaciones}\n}`);
    hechos += trozo.length;
    console.log(`  ${String(hechos)}/${String(pares.length)} ${etiqueta}`);
  }
}

async function main() {
  const backlog = JSON.parse(await readFile(new URL('./backlog.json', import.meta.url), 'utf8'));

  console.log(`Repositorio: ${REPO}`);
  console.log(
    `Fases: ${String(backlog.fases.length)} · Tareas del plan: ${String(backlog.tareas.length)}`,
  );
  if (dryRun) console.log('Modo simulación: no se escribe nada en GitHub.\n');

  console.log('\n▸ Tablero');
  const { numero, id: projectId } = await tablero();
  if (dryRun) return;

  console.log('\n▸ Campo de épicas');
  const fase = await campoFase(projectId, backlog.fases);
  const estado = await campoEstado(projectId);

  console.log('\n▸ Issues');
  const lista = await issues();
  console.log(`  ${String(lista.length)} issues en el repositorio`);
  const items = await añadir(projectId, lista);

  // El prefijo del título («F5.7 · …») dice a qué fase pertenece el issue. Se
  // resuelve contra backlog.json y no por texto, para que un título editado a
  // mano no lo mueva de fase en silencio.
  const faseDeTarea = new Map(backlog.tareas.map((t) => [t.id, t.fase]));
  const nombreDeFase = new Map(backlog.fases.map((f) => [f.id, `${f.id} · ${f.nombre}`]));

  const paresFase = [];
  const paresEstado = [];
  const sinFase = [];
  for (const issue of lista) {
    const itemId = items.get(issue.number);
    const idTarea = issue.title.split(' · ')[0]?.trim();
    const idFase = idTarea === undefined ? undefined : faseDeTarea.get(idTarea);
    if (idFase === undefined) {
      sinFase.push(issue.number);
      continue;
    }
    const opcion = fase.opciones.get(nombreDeFase.get(idFase));
    if (opcion !== undefined) paresFase.push([itemId, opcion]);

    if (estado) {
      // F0 está entregada y esperando el GO de Alex; el resto no ha empezado.
      const nombreEstado = idFase === 'F0' ? 'In Progress' : 'Todo';
      const opcionEstado = estado.opciones.get(nombreEstado);
      if (opcionEstado !== undefined) paresEstado.push([itemId, opcionEstado]);
    }
  }

  console.log('\n▸ Épica de cada issue');
  await rellenar(projectId, fase.id, paresFase, 'con su fase');

  if (estado && paresEstado.length > 0) {
    console.log('\n▸ Estado inicial (F0 en curso, el resto por hacer)');
    await rellenar(projectId, estado.id, paresEstado, 'con su estado');
  }

  if (sinFase.length > 0) {
    console.log(
      `\n  ${String(sinFase.length)} issue(s) sin tarea del plan, añadidos sin fase: ${sinFase.join(', ')}`,
    );
  }

  console.log(`\nListo: https://github.com/users/${DUENO}/projects/${String(numero)}`);
  console.log('Falta un clic en la web: añadir una vista de tablero («Board») agrupada');
  console.log('por Fase. La API de GitHub no permite crear vistas, solo leerlas.');
}

main().catch((error) => {
  console.error('\nHa fallado:', error.message);
  process.exit(1);
});
