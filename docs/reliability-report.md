# Reliability Test Stratification Report

Date: 2026-02-17  
Owner: BE-C Reliability agent

## Scope

This change set establishes deterministic test stratification and flaky assertion hardening for chaos/perf/non-deterministic suites while keeping business-critical regression coverage in required PR tiers.

## Tier Gating Model

- Tier 1 (PR required): `npm run test:tier1`
  - lint + build + unit
- Tier 2 (PR required with Docker): `npm run test:tier2`
  - integration
- Tier 3 (nightly): `npm run test:tier3`
  - chaos + perf + benchmarks + load stress

Implementation sources:
- `package.json`
- `tests/README.md`
- `README.md`
- `scripts/check-k6.mjs`
- `scripts/check-test-lifecycle.mjs`

## Business-Critical Regression Placement

Retained in required tiers:
- Tier 1 unit coverage for core auth/donation/contact/webhook/repository logic.
- Tier 2 integration coverage for canonical backend flows:
  - `tests/integration/flows/auth-flow.int.test.ts`
  - `tests/integration/flows/contact-flow.int.test.ts`
  - `tests/integration/flows/donation-lifecycle.int.test.ts`
  - `tests/integration/stripe-webhook.int.test.ts`

## Determinism Hardening Applied

- Added shared env/timing/envelope helper:
  - `tests/helpers/reliability-tier.ts`
- Converted brittle absolute perf assertions to baseline-relative envelopes with env guards in:
  - `tests/chaos/concurrent-rate-limit.test.ts`
  - `tests/performance/regression.bench.test.ts`
  - `tests/benchmarks/rate-limiting.bench.ts`
  - `tests/unit/lru-cache-performance.test.ts`
- Added Tier 3 opt-in guard (`TEST_TIER3=1`) to prevent nondeterministic suites from destabilizing PR-required tiers.
- Added static lifecycle enforcement script for integration/e2e harness discipline:
  - `scripts/check-test-lifecycle.mjs`
  - wired into `npm run lint` via `npm run lint:repo`
- Replaced non-deterministic random stress generation with deterministic seeded RNG in:
  - `tests/unit/lru-cache-performance.test.ts`

## Determinism Evidence Checklist

- [x] Nondeterministic stress suites are excluded from Tier 1/Tier 2 required gates by default.
- [x] Tier 3-only suites require explicit opt-in (`TEST_TIER3=1`).
- [x] Perf assertions use relative envelopes (ratio to local baseline), not fixed machine-specific constants.
- [x] Envelope thresholds are configurable via environment (`TEST_TIER3_*`).
- [x] Timings use high-resolution monotonic clock helpers.
- [x] Benchmarks clean up external resources (Redis client/container teardown).
- [x] PR-required tiers retain business-critical regression coverage.
- [x] Async app-factory lifecycle invariants are continuously enforced by lint-time governance checks.

## Red -> Green Lineage Template

Use this template for each flaky failure remediation item.

```md
### Reliability Item: <short name>

- Initial state (Red):
  - Failing test(s): <path::test-name>
  - Failure mode: <timing flake | race | resource leak | nondeterministic ordering>
  - Reproduction command: `<exact command>`
  - Frequency: <e.g. 2/10 runs>

- Intervention:
  - Determinism action: <env guard | baseline envelope | seeded RNG | explicit wait strategy>
  - Files changed:
    - `<path>`
  - Threshold/env variables introduced:
    - `<VAR=value default>`

- Validation (Green):
  - Verification command(s): `<exact commands>`
  - Result: <pass/fail + run count>
  - Evidence:
    - <key metric before/after>
    - <stability ratio / envelope result>

- Follow-up:
  - Residual risk:
  - Additional hardening needed:
```

## Observed Execution Lineage (2026-02-17)

### Reliability Item: Prisma client generation after clean install

- Initial state (Red):
  - Failure mode: after `npm ci`, required gates failed with `Cannot find module '.prisma/client/default'`.
  - Impact: build, unit, integration, e2e, and aggregate test commands failed on clean environments.
- Intervention:
  - Determinism action: enforce `npm run prisma:generate` inside `build`, `test`, `test:integration`, and `test:e2e`.
  - Files changed:
    - `package.json`
    - `.github/workflows/backend-gates.yml`
- Validation (Green):
  - Verification command sequence rerun from clean install baseline:
    - `npm ci`
    - `npm run build`
    - `npm run lint`
    - `npm run test:unit`
    - `npm run test:integration`
    - `npm run test:e2e`
    - `npm run test`
  - Result: all PASS (see `artifacts/baseline/summary.txt`).

### Reliability Item: Async app factory lifecycle misuse

- Initial state (Red):
  - Failing tests included unresolved app factory usage in integration/e2e suites.
  - Failure mode: `app.inject` calls on unresolved `buildApp(...)` promise / inconsistent app teardown.
- Intervention:
  - Determinism action: enforce `await buildApp(...)`, explicit `await app.ready()`, and deterministic `await app.close()` lifecycle.
  - Files changed:
    - `tests/e2e/health.e2e.test.ts`
    - `tests/integration/*.int.test.ts`
    - `tests/integration/flows/*.int.test.ts`
- Validation (Green):
  - Verification commands:
    - `npm run lint`
    - `npm run test:tier1`
  - Result: pass

### Reliability Item: Chaos/perf brittle absolute thresholds

- Initial state (Red):
  - Failure mode: machine-noise-sensitive absolute assertions in chaos/performance suites.
- Intervention:
  - Determinism action: Tier 3 guard + baseline-ratio envelopes + configurable `TEST_TIER3_*` thresholds.
  - Files changed:
    - `tests/chaos/concurrent-rate-limit.test.ts`
    - `tests/performance/regression.bench.test.ts`
    - `tests/benchmarks/rate-limiting.bench.ts`
    - `tests/helpers/reliability-tier.ts`
- Validation (Green):
  - Verification command: `npm run test`
  - Result: chaos/perf suites skipped by default unless `TEST_TIER3=1`, preventing PR-tier nondeterminism.

### Reliability Item: Nightly Tier 3 execution governance

- Initial state (Red):
  - Failure mode: Tier 3 suites existed but had no deterministic nightly CI execution path.
  - Additional failure mode observed during first rollout: instability from noisy lower-bound ratios and non-deterministic benchmark metric collection.
- Intervention:
  - Determinism action: added workflow schedule (`06:00 UTC`) with dedicated `nightly-tier3` job running `npm run test:tier3:nightly`.
  - Determinism action: hardened Tier 3 envelopes and benchmark harness:
    - removed lower-bound "faster is failure" checks in latency/benchmark suites
    - switched benchmark collectors from flaky zero-valued Tinybench result surface to deterministic timed-loop metrics
    - added envelope floors/jitter knobs for memory and error-path latency checks
  - Files changed:
    - `.github/workflows/backend-gates.yml`
    - `package.json`
    - `tests/chaos/concurrent-rate-limit.test.ts`
    - `tests/performance/regression.bench.test.ts`
    - `tests/unit/lru-cache-performance.test.ts`
    - `tests/benchmarks/rate-limiting.bench.ts`
    - `vitest.config.ts`
- Validation (Green):
  - Verification command: `npm run test:tier3:nightly`
  - Result: pass (chaos + perf + benchmark suites all green under Tier 3 run).
