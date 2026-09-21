import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Note on versions: this project is pinned to ESLint 9 rather than 10 because
 * eslint-plugin-jsx-a11y (last published 2024-10-26) declares support only up
 * to ESLint 9, and npm refuses the peer conflict. Accessibility linting is
 * worth more to this project than being on the newest major of a dev-only
 * tool. Revisit when jsx-a11y ships ESLint 10 support.
 */
export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', '.vercel/**']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // These config files are not part of the TypeScript program, but the
          // type-aware rules still want a program for them.
          allowDefaultProject: ['eslint.config.js', 'commitlint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Browser application code.
  {
    files: ['src/**/*.{ts,tsx}'],
    // react-hooks v7 keeps its legacy (`plugins: []`) configs at
    // `configs.recommended`; the flat-config variants live under `configs.flat`.
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.flatConfigs.recommended],
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // This project is an animation showcase; motion values legitimately need
      // stable identities, so a missing dependency is an error, not a warning.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Serverless functions, shared code and scripts run on Node.
  {
    files: ['api/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Tests may use non-null assertions and looser typing.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Config files are plain Node modules and are not part of the app program.
  {
    files: ['*.config.{js,ts}', '*.config.*.{js,ts}'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  {
    rules: {
      // Guard rails that matter for this codebase specifically.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
]);
