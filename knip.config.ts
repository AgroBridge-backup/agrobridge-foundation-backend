import type { KnipConfig } from 'knip';

/**
 * Knip configuration — dead-code gate for the backend (knip v6 API).
 *
 * Triage policy: this is a guardrails PR. Application source (`src/**`) is the
 * gated surface. Pre-existing dead code and tooling-only files are configured
 * here with a one-line reason each rather than deleted in this PR (deletion is
 * tracked for a follow-up). The goal is `npx knip` exits 0 so CI can gate on it.
 */
const config: KnipConfig = {
  // Real entry points. src/server.ts and prisma/seed.ts are auto-detected from
  // package.json scripts, so only the non-obvious ones are listed here.
  entry: [
    'prisma/prisma.config.ts', // loaded by the Prisma CLI
    'playwright.config.ts', // loaded by the Playwright CLI
    'contracts/scripts/**/*.ts', // openapi/contract export scripts (npm run contracts:*)
    'contracts/**/*.ts', // contract schema/type modules consumed by the contract snapshot + frontend-compat CI gate
    'scripts/**/*.{mjs,ts}', // ops/release scripts referenced from package.json
    'load-tests/k6/scenarios/*.js', // executed directly by the k6 CLI
  ],

  // Application source is the gated surface.
  project: ['src/**/*.ts'],

  // Files excluded from analysis. Each has a one-line reason.
  ignore: [
    // Tests resolve .js extension imports (NodeNext) at runtime via tsx/vitest,
    // but tests/ is outside tsconfig.include so knip can't resolve them.
    // Test coverage is enforced by the vitest/playwright gates, not knip.
    'tests/**',
    // Route schema definition files intended for OpenAPI/contract tooling but
    // not currently imported by handlers or contract scripts (pre-existing).
    'src/api/schemas/auth.schema.ts',
    'src/api/schemas/donations.schema.ts',
    'src/api/schemas/health.schema.ts',
    // Pre-existing unused modules — deletion deferred to a follow-up hygiene PR.
    'src/cache/cache-service.ts', // unused cache abstraction
    'src/observability/rate-limiting-tracer.ts', // unused tracing helper
    'src/rate-limiting/adaptive-rate-limiter.ts', // alternate impl not wired in
    'src/rate-limiting/token-bucket-rate-limiter.ts', // alternate impl not wired in
    'src/rate-limiting/health-check.ts', // class not wired into any route
    'src/resilience/circuit-state.ts', // unused circuit-breaker state helper
    // Pre-existing dual named+default export utilities, unused in application code.
    'src/utils/circuit-breaker.ts', // exported but never imported by src (tests only, excluded above)
    'src/utils/lru-cache.ts', // superseded by the rate-limit store; only referenced by an excluded perf test
  ],

  // Binaries invoked via the k6/playwright CLIs (not resolvable as node binaries).
  ignoreBinaries: ['playwright', 'k6'],

  // Dependencies flagged unused/unlisted but retained (removal/declaration deferred).
  ignoreDependencies: [
    '@redis/client', // app uses the `redis` package; @redis/client retained as a transitive compat/types peer
    '@types/bcryptjs', // bcryptjs v3 ships its own types; kept until the redundant dep is removed
    '@typescript-eslint/eslint-plugin', // reserved for a future TS-lint rollout; current eslint config lints JS only
    '@typescript-eslint/parser', // reserved for a future TS-lint rollout; current eslint config lints JS only
    'tinybench', // consumed by tests/benchmarks (excluded from this gate)
    'vite-tsconfig-paths', // consumed by the vitest config (excluded from this gate)
    // Modules provided by external runtimes, not npm packages:
    '@playwright/test', // injected by the Playwright CLI runner
  ],

  // Per-file issue-type ignores for still-used files whose exported public API
  // surface (observability, sanitization, DTO types) is retained for internal and
  // contract consumers. Trimming is out of scope for this guardrails PR.
  ignoreIssues: {
    // Route schema definitions consumed by OpenAPI/contract snapshot tooling.
    'src/api/schemas/admin.schema.ts': ['exports', 'types'],
    // Error classification + observability exported API surface.
    'src/errors/error-taxonomy.ts': ['exports', 'types'],
    'src/middleware/error-observability.ts': ['exports'],
    'src/observability/db-span.ts': ['exports'], // activeTraceId helper
    'src/observability/error-metrics.ts': ['exports'],
    'src/observability/metrics/rate-limiting-metrics.ts': ['exports'],
    // Rate-limiting config constant (ROUTE_TIERS).
    'src/rate-limiting/tier-config.ts': ['exports'],
    // Public sanitization API (XSS_PATTERNS, sanitize*).
    'src/lib/xss-sanitizer.ts': ['exports'],
    // getFeatureFlags: exported public helper, also consumed in-file.
    'src/api/routes/feature-flags.ts': ['exports'],
    // Service input type definitions (DTO shapes for handlers/tests).
    'src/services/admin-user-service.ts': ['types'],
    'src/services/campaign-service.ts': ['types'],
    // Cursor pagination type.
    'src/utils/cursor.ts': ['types'],
    // k6 load-test scenarios import k6/http + k6/execution, which are injected
    // by the k6 runtime and are not (and should not be) npm packages.
    'load-tests/k6/scenarios/*.js': ['unlisted'],
  },
};

export default config;
