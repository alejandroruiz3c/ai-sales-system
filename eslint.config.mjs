import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
      'no-restricted-syntax': [
        'error',
        {
          // Secreto en código = fallo de revisión. Solo process.env, nunca literales.
          selector: 'Literal[value=/^(sk-|pk_live_|rk_live_|whsec_|xoxb-|ghp_|github_pat_)/]',
          message:
            'Parece un secreto en código. Los secretos van en Vercel, GitHub Environments o Supabase Vault, nunca en el repo.',
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
