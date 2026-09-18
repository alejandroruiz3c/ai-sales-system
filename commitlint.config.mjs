/**
 * Conventional Commits obligatorios (plan §4).
 *
 * Los `scope` permitidos son los paquetes del monorepo más las áreas
 * transversales. Un commit sin scope válido se rechaza: así el historial dice
 * siempre qué parte del sistema cambió, que es lo que hace útil un `git log`
 * cuando hay varios equipos trabajando en paralelo.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'refactor',
        'test',
        'perf',
        'ci',
        'build',
        'revert',
        'style',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // Aplicaciones
        'web',
        'worker',
        // Paquetes
        'core',
        'db',
        'llm',
        'prompts',
        'studio',
        'integrations',
        'capacity',
        'config',
        // Agentes
        'onboarding',
        'prospecting',
        'coordinator',
        'email',
        'linkedin',
        'voice',
        'closing',
        'cs',
        'opinion',
        'copilot',
        // Transversales
        'reglas', // CLAUDE.md, AGENTS.md, CONTRIBUTING.md: las normas del repo
        'plan',
        'adr',
        'entregas',
        'scripts',
        'infra',
        'ci',
        'deps',
        'sandbox',
        'lab',
        'e2e',
        'release',
      ],
    ],
    'scope-empty': [1, 'never'],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
