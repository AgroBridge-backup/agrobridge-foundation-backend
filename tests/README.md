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
  - These tests are the primary correctness gate.

- `tests/e2e/`
  - Full request/response shape checks.
  - Can be DB-free or DB-backed depending on the scenario.

## Running

- Unit + non-Docker suites (always available):
  - `npm run test`

- Full suite + coverage (requires Docker Desktop):
  - `npm run test:coverage`

`npm run test:coverage` fails fast if Docker isn’t available (see `scripts/check-docker.mjs`). This prevents misleading "coverage" results.

## Common Helpers

- `tests/helpers/env.ts`: canonical test environment setup. Use this instead of ad-hoc env mutations.
- `tests/helpers/admin-cookie.ts`: signs the `ab_admin` cookie using Fastify’s cookie signer (no manual crypto).

## Troubleshooting

- Error: `Could not find a working container runtime strategy`
  - Docker daemon is not available.
  - Start Docker Desktop and retry.

- Prisma schema issues in tests
  - `tests/integration/test-db.ts` runs `npx prisma db push --skip-generate` after the container starts.
  - If you add tables/fields, integration tests automatically pick up the new schema.
