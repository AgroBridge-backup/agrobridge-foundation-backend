# Error Budget Policy

Date: 2026-02-17  
Owner: Backend Platform Reliability

## SLOs and Measurement Windows

Primary endpoints in scope:

- `GET /api/health`
- `POST /api/contacts`
- `POST /api/donations/intent`

SLO targets:

- Availability SLO: `>= 99.9%` over rolling 30 days.
- Latency SLO: p95 `<= 1000ms` over rolling 30 days.
- Readiness SLO: readiness/up signal `>= 1` during deploy windows.

Operational burn windows used for enforcement:

- Short window burn: 1 hour
- Long window burn: 6 hours

## Budget Definition

- Monthly error budget = `1 - 0.999 = 0.001` (0.1% allowed bad events).
- Remaining budget signal: `error_budget_remaining_ratio`
- Burn-rate signals:
  - `error_budget_burn_rate_1h`
  - `error_budget_burn_rate_6h`

## Release Freeze Trigger

Feature releases are blocked when any of the following is true:

1. Remaining budget `<= ERROR_BUDGET_MIN_REMAINING` (default `0`).
2. 1h burn-rate `> ERROR_BUDGET_MAX_BURN_RATE_1H` (default `2`).
3. 6h burn-rate `> ERROR_BUDGET_MAX_BURN_RATE_6H` (default `1`).

Enforced by:

- `scripts/reliability/check-error-budget.mjs`
- `preprod-release-gate.yml`
- `canary-deploy.yml`

## Exception Process (Auditable Override)

Allowed only for security patches or legal/compliance hotfixes.

Required override fields:

- `ERROR_BUDGET_OVERRIDE=approved`
- `ERROR_BUDGET_OVERRIDE_REASON`

Authorization control:

- Override runs must execute in protected GitHub Environments (`preprod` or `canary`) with required reviewers.
- Reviewer approval is enforced by GitHub environment protection, not by user-entered text fields.
- Actor identity and run metadata are captured from GitHub context in `error-budget-check.json`.
- Current repository billing plan does not support required-reviewer environment protection (GitHub API returns HTTP 422); until plan upgrade, this remains a tracked governance gap.

Override evidence is persisted to:

- `artifacts/reliability/error-budget-check.json`

## Exit Criteria for Unfreeze

Release freeze is lifted only after all are true:

1. Remaining budget is above threshold.
2. Burn rates are below thresholds for two consecutive checks.
3. Incident corrective actions are documented in runbooks/postmortem.
4. Canary SLO monitor passes without breach for a full observation window.
