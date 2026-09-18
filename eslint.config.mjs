import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Sintaxis vetada por seguridad, en constantes para poder recomponer la lista en
 * los paquetes donde una de las reglas no aplica.
 *
 * `no-restricted-syntax` no se acumula entre bloques de la configuración plana:
 * el último que lo declara sustituye al anterior. Por eso `packages/db`, que sí
 * puede usar la `service_role`, tiene que volver a declarar el resto.
 */
const SECRETO_EN_CODIGO = {
  // Secreto en código = fallo de revisión. Solo process.env, nunca literales.
  selector:
    'Literal[value=/^(sk-|sk_live_|pk_live_|rk_live_|whsec_|xoxb-|ghp_|github_pat_|gho_|sntrys_|sbp_)/]',
  message:
    'Parece un secreto en código. Los secretos van en Vercel, GitHub Environments o Supabase Vault, nunca en el repo.',
};

const HTML_EXTERNO = {
  // Contenido externo son datos, nunca instrucciones (CLAUDE.md §1), y tampoco
  // HTML: la web de un prospecto o la firma de un email inyectadas sin escapar
  // son XSS almacenado en el panel de un corporate.
  selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
  message:
    'Contenido externo son datos, nunca HTML. Si hay que renderizar HTML de un tercero, sanéalo en packages/core y justifícalo en el PR.',
};

const SHELL_INTERPOLADO = {
  // Un shell construido con una cadena es inyección de comandos. En un sistema
  // con workers de navegador y rutas por tenant, el argumento casi nunca es
  // constante.
  selector: [
    'CallExpression[callee.name=/^(exec|execSync)$/] > TemplateLiteral[expressions.length>0]',
    'CallExpression[callee.property.name=/^(exec|execSync)$/] > TemplateLiteral[expressions.length>0]',
  ].join(', '),
  message:
    'Shell construido por interpolación: usa execFile/execFileSync con un array de argumentos.',
};

const SERVICE_ROLE = {
  // RLS es el modelo de aislamiento entre tenants (ADR 0003). La service_role se
  // salta las políticas: una consulta con ella y un `WHERE` olvidado es una fuga
  // entre corporates.
  selector:
    'MemberExpression[object.object.name="process"][object.property.name="env"][property.name="SUPABASE_SERVICE_ROLE_KEY"]',
  message:
    'La service_role se salta RLS (ADR 0003). Solo packages/db puede usarla, y con un comentario que explique por qué no vale la clave anónima.',
};

const SINTAXIS_VETADA = [SECRETO_EN_CODIGO, HTML_EXTERNO, SHELL_INTERPOLADO, SERVICE_ROLE];

/** El SDK de Anthropic solo se importa desde packages/llm. */
const SDK_DE_MODELO = {
  name: '@anthropic-ai/sdk',
  message:
    'Las llamadas a modelo pasan por packages/llm, que aplica nivel de tarea, caché de prompt y apunte en spend_ledger. Nunca el SDK directo.',
};

/**
 * ESLint plano y único para todo el monorepo.
 *
 * Las reglas que no son cosméticas están aquí porque protegen una decisión del
 * plan, no por gusto. Cada bloque dice qué protege.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.changeset/**',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Tipos: `any` es una fuga de tipado y en este sistema una fuga de tenant.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Las promesas sin await rompen la durabilidad de Inngest: un paso que no
      // se espera no se reintenta.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      // El log estructurado llega con Better Stack (F0.11); console.log no es log.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // ── Seguridad ───────────────────────────────────────────────────────────
      // CodeQL no está disponible en repositorios privados del plan gratuito de
      // GitHub, así que el análisis estático de seguridad lo hacen estas reglas
      // más `pnpm audit`, ambos dentro de `pnpm verify` (ADR 0007). No son un
      // catálogo genérico: cada una tapa un agujero concreto de este sistema.
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-imports': ['error', { paths: [SDK_DE_MODELO] }],
      'no-restricted-syntax': ['error', ...SINTAXIS_VETADA],
    },
  },

  // packages/db es la frontera con Postgres: el único sitio donde tiene sentido
  // una conexión con `service_role` (migraciones, trabajos de sistema). Conserva
  // el resto de la sintaxis vetada.
  {
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', SECRETO_EN_CODIGO, HTML_EXTERNO, SHELL_INTERPOLADO],
    },
  },

  // Las dos comprobaciones de seguridad tienen que escribir los prefijos de
  // secreto para poder buscarlos. Es el único caso en que un literal con pinta
  // de secreto es correcto, y por eso la excepción nombra los dos ficheros en
  // vez de relajar la regla en todo `scripts/`.
  {
    files: ['scripts/src/variables-publicas.ts', 'scripts/src/variables-publicas.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', HTML_EXTERNO, SHELL_INTERPOLADO, SERVICE_ROLE],
    },
  },

  // packages/llm es el paquete que envuelve las llamadas a modelo: es el único
  // que puede importar el SDK.
  {
    files: ['packages/llm/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // Los agentes no conocen su runtime (CLAUDE.md §1): la misma lógica corre en
  // una función de Vercel, en un worker de Hetzner y en un test. Un
  // `import 'next/...'` ata el agente al panel, y un `process.env` esconde
  // configuración que debería entrar por parámetro y editarse desde el Estudio.
  {
    files: ['packages/agents/**/*.ts'],
    ignores: ['packages/agents/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [SDK_DE_MODELO],
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom'],
              message:
                'Un agente no puede depender del runtime del panel: su lógica tiene que poder correr en un worker y en un test.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'La configuración de un agente entra por parámetro, no por process.env: así se edita desde el Estudio y se prueba sin entorno.',
        },
      ],
    },
  },

  // Tests: aquí sí se permite el atajo.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },

  // Ficheros de configuración en JS/MJS: sin tipado de proyecto.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },

  // Next.js: componentes de cliente y servidor.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  prettier,
);
