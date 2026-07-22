import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

const jsFiles = ['**/*.{js,mjs,cjs}'];

export default [
  {
    ignores: [
      'artifacts/**',
      'contracts/**',
      'coverage/**',
      'dist/**',
      'load-tests/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: jsFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  {
    ...js.configs.recommended,
    files: jsFiles,
  },
  {
    files: jsFiles,
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/order': ['error', { alphabetize: { order: 'asc' } }],
      'no-console': 'off',
    },
  },
  prettier,
];
