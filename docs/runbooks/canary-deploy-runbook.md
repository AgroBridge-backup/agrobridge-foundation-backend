# Canary Deploy Runbook

Date: 2026-02-17  
Owner: Backend Platform Reliability

## Purpose

Safely release backend changes via limited traffic canary and auto-rollback on SLO breach.

## Preconditions

1. `Preprod Release Gate` passed.
2. Error budget check passes or approved override is present.
3. Deployment/rollback commands are configured:
   - `CANARY_DEPLOY_COMMAND`
   - `CANARY_ROLLBACK_COMMAND`
4. Prometheus connectivity is configured:
   - `PROMETHEUS_BASE_URL`
   - `PROMETHEUS_BEARER_TOKEN` (if required)

## Automated Path (GitHub Actions)

Workflow: `.github/workflows/canary-deploy.yml`

It executes:

1. `scripts/reliability/check-error-budget.mjs`
2. `scripts/release/deploy-canary.sh`
3. `scripts/release/monitor-slo.mjs`
4. `scripts/release/rollback-canary.sh` on failure

Artifacts:

- `artifacts/canary/deploy-canary.log`
- `artifacts/canary/slo-monitor.json`
- `artifacts/canary/rollback-canary.log` (if rollback happened)
- `artifacts/reliability/error-budget-check.json`

## Manual Execution (Operator Fallback)

```bash
cd /Users/mac/Documents/agrobridge-foundation-backend
npm ci
npm run prisma:generate
npm run build
node scripts/reliability/check-error-budget.mjs
./scripts/release/deploy-canary.sh
node scripts/release/monitor-slo.mjs
```

If SLO breach is detected:

```bash
./scripts/release/rollback-canary.sh
```

## Rollback Triggers

Rollback is mandatory when any condition is true:

1. Error rate exceeds configured threshold.
2. p95 latency exceeds configured threshold.
3. Readiness/up signal falls below threshold.

## Escalation Contacts

- Incident Commander (on-call)
- Backend Platform owner
- Infrastructure/SRE owner
- Product operations lead

Escalate immediately if rollback fails or recovery exceeds 15 minutes.
