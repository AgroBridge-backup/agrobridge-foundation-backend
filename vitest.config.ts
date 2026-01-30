import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
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
