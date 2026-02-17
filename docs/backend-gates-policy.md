# Backend Gates and Branch Protection Policy

Date: 2026-02-17  
Owner: Backend IC8 execution lead

## Required CI Jobs (PR Gate)

These checks must be required in GitHub branch protection for `main`:

1. `lint`
2. `build`
3. `unit`
4. `integration`
5. `e2e`

Additional recommended required check:

6. `contracts`
7. `frontend-compat`
8. `release-report` (recommended required for governance evidence)

## Command-to-Risk Matrix

| Gate command | Risk controlled | CI job |
| --- | --- | --- |
| `npm run lint` | Unsafe style/tooling drift, latent static defects | `lint` |
| `npm run build` | Type/runtime contract breakage | `build` |
| `npm run test:unit` | Core business logic regressions | `unit` |
| `npm run test:integration` | DB/route/repository interaction regressions | `integration` |
| `npm run test:e2e` | Backend end-to-end route and app-lifecycle regressions | `e2e` |
| `npm run contracts:check` | API contract drift and backward-compat breaks | `contracts` |

## Branch Protection Mapping

In GitHub repository settings for `main`:

1. Enable `Require a pull request before merging`.
2. Enable `Require status checks to pass before merging`.
3. Mark required checks:
   - `lint`
   - `build`
   - `unit`
   - `integration`
   - `e2e`
   - `contracts` (recommended required)
   - `frontend-compat` (recommended required)
   - `release-report` (recommended required)
4. Enable `Require branches to be up to date before merging`.
5. Enable `Do not allow bypassing the above settings`.
6. Restrict direct pushes to `main`.

## Tiering Policy

- Tier 1 (required every PR): `npm run test:tier1` (lint + unit, with build enforced by `test:unit`)
- Tier 2 (required every PR with Docker): `npm run test:tier2` (integration)
- Tier 3 (nightly): `npm run test:tier3` (chaos/perf/bench/load with deterministic envelopes)

Nightly schedule is executed by CI at `06:00 UTC` via workflow cron and runs `npm run test:tier3:nightly` for deterministic chaos/perf/benchmark signal capture.

## Artifact Governance

- Gate logs are uploaded on every CI execution (`if: always()`), not only on failures.
- Release readiness report artifacts are emitted per workflow run under `artifacts/release/` via `npm run report:release`.
