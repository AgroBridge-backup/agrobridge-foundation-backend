import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that resolves .js and extensionless imports to .ts source files.
 *
 * Handles two issues:
 * 1. NodeNext module resolution requires .js extensions in imports, but Vitest
 *    needs to resolve to the actual .ts sources.
 * 2. Test files in subdirectories (e.g. tests/unit/auth/) use ../../src/ instead
 *    of ../../../src/ — the plugin re-resolves these against the project root.
 */
function resolveJsToTs(): Plugin {
  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;

      const importerDir = resolve(importer, '..');
      const absolutePath = resolve(importerDir, source);

      // For .js imports: check if literal .js exists
      if (source.endsWith('.js')) {
        if (existsSync(absolutePath)) return null;

        // Try .ts at the same location
        const tsPath = absolutePath.replace(/\.js$/, '.ts');
        if (existsSync(tsPath)) return tsPath;
      }

      // For extensionless imports: try adding .ts
      if (!source.endsWith('.js') && !source.endsWith('.ts')) {
        const tsPath = absolutePath + '.ts';
        if (existsSync(tsPath)) return tsPath;
      }

      // Re-resolve against project root for src/ imports.
      // Handles tests/unit/subdir/ files that use ../../src/ instead of ../../../src/
      const srcIdx = source.indexOf('src/');
      if (srcIdx !== -1) {
        const srcRelative = source.slice(srcIdx);
        const base = srcRelative.replace(/\.js$/, '');
        const rootTs = resolve(__dirname, base + '.ts');
        if (existsSync(rootTs)) return rootTs;
      }

      // Re-resolve test helper imports (mocks/, fixtures/, helpers/)
      // from tests/unit/subdir/ that use ../mocks/ instead of ../../mocks/
      const segments = source.split('/');
      const nonRelative = segments.filter(s => s !== '..' && s !== '.').join('/');
      const base = nonRelative.replace(/\.js$/, '');
      const fromTestsDir = resolve(__dirname, 'tests', base + '.ts');
      if (existsSync(fromTestsDir)) return fromTestsDir;

      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsToTs()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 95,
        statements: 98,
      },
      include: [
        'src/services/**',
        'src/webhooks/**',
        'src/api/routes/**',
        'src/repositories/**',
        'src/auth/**',
        'src/utils/**',
        'src/config/**',
        'src/errors/**',
        'src/http/**',
      ],
      exclude: ['src/app.ts', 'src/server.ts', 'src/db/**'],
    },
  },
});
