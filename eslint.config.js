// ESLint flat config for the analyzr workspace. ESLint looks it up from the
// linted file's directory upwards, so `eslint .` inside any package uses it.
// TypeScript files are linted type-aware through the TypeScript project
// service (each file's nearest tsconfig.json).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Packages whose values only the lazy value chain chunk of the web app may import. */
const CHAIN_CHUNK_PACKAGES = [
  '@miragon/value-chain-renderer',
  '@miragon/value-chain-schema-model',
  'diagram-js',
  'zod',
];
const CHAIN_CHUNK_MESSAGE =
  'Only the lazy chain chunk (src/components/value-chain/canvas/) may import the value chain renderer, schema-model, diagram-js or zod (M4 §5).';

/**
 * The web imports types from the contracts, never their zod schemas; the
 * runtime imports are the zod-free `@analyzr/contracts/paths` (M6 S1),
 * `@analyzr/contracts/open-question-labels` (M6 S4), for answers (M6
 * S5a) `@analyzr/contracts/open-question-csv` and
 * `@analyzr/contracts/personal-data`, for model amendments (M6 S5c-2)
 * `@analyzr/contracts/amendment-labels`, for the „Vorschau“'s batches (M6
 * S2b follow-up) `@analyzr/contracts/impact-merge`, and for a dropped
 * bundle's manifest (UX8) `@analyzr/contracts/import-manifest`, the one with
 * zod, loaded with a dynamic import (all but `paths` and `impact-merge` in
 * lazy chunks only, which the bundle guard checks). `paths` entries match the bare specifier
 * only, so a pattern restricts every other subpath.
 */
const CONTRACTS_MESSAGE =
  'Import types from @analyzr/client; constants live in src/lib/limits.ts; the file rule comes from @analyzr/contracts/paths, the open-question labels from @analyzr/contracts/open-question-labels, the answer sheet reader from @analyzr/contracts/open-question-csv, the personal-data check from @analyzr/contracts/personal-data, the amendment labels from @analyzr/contracts/amendment-labels, the merge of the preview batches from @analyzr/contracts/impact-merge, the schema of a bundle manifest from @analyzr/contracts/import-manifest (a dynamic import).';
const CONTRACTS_RESTRICTION = {
  paths: [{ name: '@analyzr/contracts', message: CONTRACTS_MESSAGE, allowTypeImports: true }],
  patterns: [
    {
      group: [
        '@analyzr/contracts/*',
        '!@analyzr/contracts/paths',
        '!@analyzr/contracts/open-question-labels',
        '!@analyzr/contracts/open-question-csv',
        '!@analyzr/contracts/personal-data',
        '!@analyzr/contracts/amendment-labels',
        '!@analyzr/contracts/impact-merge',
        '!@analyzr/contracts/import-manifest',
      ],
      message: CONTRACTS_MESSAGE,
      allowTypeImports: true,
    },
  ],
};

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '.claude/',
    '.playwright-mcp/',
    // generated
    'packages/client/src/generated/',
    'apps/server/drizzle/',
    'eval/corpus/',
    // deliberate violations and inputs for tests
    '**/test/fixtures/',
  ]),

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite'] },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // The bundle gets types from the contracts, never their zod schemas: use
    // the generated @analyzr/client types (constants are mirrored in src/lib/limits.ts);
    // the zod-free @analyzr/contracts/paths (M6 S1), …/open-question-labels (M6 S4),
    // …/open-question-csv and …/personal-data (M6 S5a), …/amendment-labels (M6 S5c-2)
    // and …/import-manifest (UX8, a dynamic import) are the runtime imports.
    // The value chain renderer, schema-model (with zod) and diagram-js belong to
    // the lazy chain chunk only (M4 §5): values from them are allowed in
    // src/components/value-chain/canvas/** alone (override below).
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            ...CONTRACTS_RESTRICTION.paths,
            ...CHAIN_CHUNK_PACKAGES.map((name) => ({
              name,
              message: CHAIN_CHUNK_MESSAGE,
              allowTypeImports: true,
            })),
          ],
          patterns: [
            ...CONTRACTS_RESTRICTION.patterns,
            {
              group: ['diagram-js/*', '@miragon/value-chain-renderer/*'],
              message: CHAIN_CHUNK_MESSAGE,
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    // The lazy chain chunk: renderer, schema-model, diagram-js and zod are its own.
    files: ['apps/web/src/components/value-chain/canvas/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', CONTRACTS_RESTRICTION],
    },
  },
  {
    // shadcn components export their variants; TanStack route modules export
    // route objects next to their page components (full reload on change).
    files: ['apps/web/src/components/ui/**/*.tsx', 'apps/web/src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
