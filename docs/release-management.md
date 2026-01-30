# Release Management

This document defines how changes get shipped safely.

Principle:

- Prefer fast rollback over slow debugging in production.

## Environments

Recommended:

- `dev`: local development
- `staging`: production-like, connected to Stripe test mode
- `production`: live traffic

## Change Types

- Config-only (env/secrets): lower risk but can break auth/webhooks.
- Schema changes: high risk; requires migrations and careful rollout.
- Code changes: normal risk; use canary or rolling deploy.

## Deployment Strategy

### MVP Default: Rolling Deploy with Health Checks

- ECS updates tasks gradually.
- ALB health checks gate traffic.
- Keep at least 2 tasks running to avoid downtime.

### Recommended Next: Canary

- Deploy a small % of tasks with new version.
- Watch:
  - 5xx rate
  - webhook failures
  - p95 latency
- Promote to 100% if clean.

## Rollback Strategy

Rollback criteria:

- 5xx spike correlated with deploy
- webhook failures spike correlated with deploy
- donation intent failing (Stripe API errors)

Rollback actions:

- revert ECS task definition to previous image
- if config-related, revert secret value and redeploy

## DB Migrations

Rules:

- Backward compatible migrations only in a single deploy.
- Avoid destructive changes (drop columns) until after all services are updated.

Recommended workflow:

1. Deploy migration (add columns/tables, keep old fields)
2. Deploy code using new schema
3. Backfill if needed
4. Remove old fields in a later release

## Feature Flags

MVP guidance:

- Only introduce flags when necessary.
- High leverage flags:
  - disable webhook processing (still persist event)
  - disable donation intents if Stripe is degraded

## Verification Checklist

Before deploy:

- `npm run test`
- `npm run test:coverage` (requires Docker)
- `npx prisma validate`

After deploy:

- `GET /api/health`
- Create test donation intent (staging)
- Verify webhook delivery in Stripe dashboard
- Verify admin dashboard loads

## Change Management

- Small PRs with clear intent.
- Deploy during working hours for MVP.
- For any payments/webhooks change:
  - require a second reviewer
  - update relevant runbooks/docs

## Emergency Deploys

- Use for SEV-1 mitigation.
- Keep scope minimal.
- Record the change in the incident timeline.
- Follow-up PR to clean up and add tests.
