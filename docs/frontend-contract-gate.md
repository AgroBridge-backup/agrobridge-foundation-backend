# Frontend Contract Gate

Date: 2026-02-17

## Objective

Block backend merges that would break frontend API usage before release by running frontend compatibility checks against backend branch contracts.

## Backend CI Wiring

Workflow: `.github/workflows/backend-gates.yml`

Added job: `frontend-compat`

Execution flow:

1. Export backend OpenAPI snapshot from the backend PR branch (`npm run contracts:openapi:export`).
2. Check out frontend repository (`AgroBridge-backup/agrobridge-foundation-web`).
3. Run frontend contract verifier:
   - `node frontend/scripts/contracts/check-backend-contract.mjs`
4. Compare frontend API expectations against backend branch artifacts:
   - `contracts/openapi/openapi.v1.snapshot.json`
   - `contracts/schemas/post-api-donations-intent.response.v1.ts`
   - `contracts/schemas/post-api-contacts.response.v1.ts`
5. Upload audit artifacts always under `artifacts/frontend-compat`.

## Frontend CI Wiring

Frontend repo workflow: `.github/workflows/frontend-backend-contract-check.yml`

Job: `backend-contract-compatibility`

This checks frontend changes against backend `main` contract artifacts to stop contract drift before frontend merge.

## Branch Protection Recommendation

Current required checks on backend `main` remain:

- `lint`
- `build`
- `unit`
- `integration`
- `e2e`

Recommended additional required checks:

- `contracts`
- `frontend-compat`
- `release-report`
