# DB Outage Runbook

Date: 2026-02-17  
Owner: Backend Platform + Data

## Symptoms

- `GET /api/health` returns `503` with `DB unavailable`.
- Elevated `5xx` from write paths (`/api/contacts`, `/api/donations/intent`).
- Error logs include Prisma/PostgreSQL connection failures.

## Detection Commands

```bash
curl -i "${PREPROD_BASE_URL}/api/health"
node scripts/release/synthetic-smoke.mjs
```

Prometheus checks:

```bash
curl -Gs "${PROMETHEUS_BASE_URL}/api/v1/query" --data-urlencode 'query=up{job="postgres"}'
curl -Gs "${PROMETHEUS_BASE_URL}/api/v1/query" --data-urlencode 'query=rate(http_requests_total{status=~"5.."}[5m])'
```

## Mitigation Steps

1. Confirm DB service health (managed DB console / cluster status).
2. Restore DB connectivity (restart proxy/primary failover as applicable).
3. Validate Prisma connectivity:

```bash
npx prisma migrate diff --from-url "${PREPROD_DATABASE_URL}" --to-schema-datamodel prisma/schema.prisma --script >/tmp/db-health-check.sql
```

4. Re-run synthetic smoke:

```bash
PREPROD_BASE_URL="${PREPROD_BASE_URL}" node scripts/release/synthetic-smoke.mjs
```

## Recovery Criteria

- `/api/health` is `200`.
- Synthetic smoke passes.
- Error-rate returns below SLO threshold.

## Escalation Contacts

- Incident Commander
- DBA/on-call data engineer
- Backend Platform owner
- Product operations lead
