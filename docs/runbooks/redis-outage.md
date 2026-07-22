# Redis Outage Runbook

Date: 2026-02-17  
Owner: Backend Platform + Infrastructure

## Symptoms

- Elevated latency and/or increased CPU due cache misses.
- Rate limiting falls back to degraded mode.
- Redis connection errors in backend logs.

## Detection Commands

```bash
curl -i "${PREPROD_BASE_URL}/api/health/rate-limit"
curl -Gs "${PROMETHEUS_BASE_URL}/api/v1/query" --data-urlencode 'query=up{job=~"redis|agrobridge-redis"}'
```

## Mitigation Steps

1. Confirm Redis service status in infrastructure control plane.
2. Restart Redis service/pod or fail over replica.
3. Verify connectivity from backend runtime.
4. Validate application behavior:

```bash
PREPROD_BASE_URL="${PREPROD_BASE_URL}" node scripts/release/synthetic-smoke.mjs
```

5. Confirm rate-limit endpoints recover:

```bash
curl -i "${PREPROD_BASE_URL}/api/health/rate-limit/deep"
```

## Recovery Criteria

- Redis `up` metric returns to `1`.
- Synthetic smoke passes.
- Rate-limit health endpoints return healthy payload.

## Escalation Contacts

- Incident Commander
- Infrastructure/SRE owner
- Backend Platform owner
- Security owner (if rate-limit protections are degraded)
