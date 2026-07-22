# Stripe Degraded Runbook

Date: 2026-02-17  
Owner: Backend Platform + Payments

## Symptoms

- `POST /api/donations/intent` failure spikes.
- Stripe API timeouts/5xx errors in backend logs.
- Donation conversion drops while health endpoint remains green.

## Detection Commands

```bash
curl -Gs "${PROMETHEUS_BASE_URL}/api/v1/query" --data-urlencode 'query=rate(http_requests_total{route="/api/donations/intent",status=~"5.."}[5m])'
PREPROD_BASE_URL="${PREPROD_BASE_URL}" node scripts/release/synthetic-smoke.mjs
```

## Mitigation Steps

1. Check Stripe status page and internal alerts.
2. Validate API key/webhook secret integrity in preprod/prod secret store.
3. If Stripe outage is external, keep contact endpoints available and suppress noisy retries.
4. If degraded only in our stack, rotate Stripe credentials and redeploy.
5. Re-test donation intent endpoint:

```bash
PREPROD_BASE_URL="${PREPROD_BASE_URL}" node scripts/release/synthetic-smoke.mjs
```

## Recovery Criteria

- Donation intent endpoint success rate returns within SLO.
- Synthetic smoke passes for `/api/donations/intent`.
- No sustained Stripe transport/auth errors in logs.

## Escalation Contacts

- Incident Commander
- Payments/on-call backend owner
- Finance operations lead
- Product operations lead
