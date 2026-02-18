# Tests

This repo treats tests as a production feature. The objective is confidence and correctness, not just coverage.

## Principles (Accuracy First)

- Prefer real infrastructure: integration tests run against real Postgres via Testcontainers.
- Assert on outcomes, not implementation:
  - route tests assert on HTTP response + persisted DB state
  - service tests assert on returned values + typed errors
- Avoid flakiness:
  - no reliance on ordering without explicit sorting
  - no reliance on wall clock time unless time is frozen
  - keep secrets deterministic in tests

## Test Categories

- `tests/unit/`
  - No DB.
  - External boundaries may be mocked (Stripe SDK, repositories).
  - Fast and deterministic.

- `tests/integration/`
  - Fastify inject + real Postgres (Testcontainers).
  - Prisma schema applied per-suite via `prisma db push --skip-generate` (see `tests/integration/test-db.ts`).
  - Primary correctness gate for end-to-end backend behavior.

- `tests/e2e/`
  - Backend end-to-end checks.
  - Primary required e2e gate uses `vitest` (`npm run test:e2e`).
  - Optional browser/UI e2e flows run with Playwright (`npm run test:e2e:ui`) and require frontend pages.

- `tests/contracts/`
  - OpenAPI snapshot compatibility + response schema locks.
  - Includes synthetic endpoint checks for `/api/health`, `/api/donations/intent`, `/api/contacts`.

- `tests/chaos/`, `tests/performance/`, `tests/benchmarks/`, and `tests/unit/lru-cache-performance.test.ts`
  - Stress/perf/chaos reliability suites.
  - Tier 3 only (`TEST_TIER3=1`) to avoid flaky PR gates.

## Execution Tiers

- Tier 1 (PR required): `npm run test:tier1`
  - Includes: lint, build, and all unit tests.
  - Business-critical regression coverage remains here (auth, donations, contacts, webhooks, repositories, JWT/cookie auth behavior).

- Tier 2 (PR required with Docker): `npm run test:tier2`
  - Includes: integration tests with real Postgres/Testcontainers.
  - Business-critical regression coverage remains here:
    - `tests/integration/flows/auth-flow.int.test.ts`
    - `tests/integration/flows/contact-flow.int.test.ts`
    - `tests/integration/flows/donation-lifecycle.int.test.ts`
    - `tests/integration/stripe-webhook.int.test.ts`

- Tier 3 (nightly): `npm run test:tier3`
  - Includes:
    - chaos/performance stress suites (`TEST_TIER3=1`)
    - Redis benchmark suite (Docker)
    - k6 load scenarios (health + spike + soak)
  - Deterministic envelope checks are configurable via `TEST_TIER3_*` env vars.

## Running

- Unit + non-Docker suites:
  - `npm run test`
  - `npm run test:tier1`
  - `npm run test:e2e`
  - `npm run test:contracts`
  - `npm run test:synthetic`

- Integration gate (Docker required):
  - `npm run test:tier2`
  - `npm run test:integration`

- Nightly stress gate:
  - `npm run test:tier3`

- Coverage (Docker required):
  - `npm run test:coverage`

`npm run test:integration`, `npm run test:coverage`, and `npm run test:tier3:benchmarks` fail fast if Docker is unavailable (`scripts/check-docker.mjs`).
`npm run test:tier3:load` fails fast if `k6` is unavailable (`scripts/check-k6.mjs`).

## Common Helpers

- `tests/helpers/env.ts`: canonical test environment setup. Use this instead of ad-hoc env mutations.
- `tests/helpers/admin-cookie.ts`: signs the `ab_admin` cookie using Fastify’s cookie signer (no manual crypto).
- `tests/helpers/reliability-tier.ts`: Tier 3 env guards + deterministic envelope helpers.

## Troubleshooting

- Error: `Could not find a working container runtime strategy`
  - Docker daemon is not available.
  - Start Docker Desktop and retry.

- Error: `k6 is required for Tier 3 load tests`
  - `k6` is not installed or unavailable on `PATH`.
  - Install `k6` and retry Tier 3 load scripts.

- Prisma schema issues in tests
  - `tests/integration/test-db.ts` runs `npx prisma db push --skip-generate` after the container starts.
  - If you add tables/fields, integration tests automatically pick up the new schema.
