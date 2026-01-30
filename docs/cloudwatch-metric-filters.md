# CloudWatch Metric Filters (Log-Based Metrics)

This document defines suggested CloudWatch Logs metric filters for the service.

Goal:

- Convert high-signal log lines into metrics and alarms.
- Avoid high-cardinality dimensions.

Prerequisites:

- Logs are JSON structured (Fastify/Pino).
- Log fields include:
  - `msg`
  - error fields where present
  - `traceId` (when OpenTelemetry is enabled)

## Metric Filter 1: Internal Errors (5xx-equivalent)

Purpose:

- Track server-side failures regardless of ALB visibility.

Filter pattern:

- Match error responses or app errors.

Suggested pattern (JSON):

```
{ $.msg = "request failed" }
```

Metric:

- Namespace: `Agrobridge/Backend`
- Name: `InternalErrors`
- Value: `1`

Alarm (ticket):

- Trigger: sum over 5 minutes > baseline + 3x

## Metric Filter 2: Stripe Webhook Signature Failures

Purpose:

- Detect misconfiguration (`STRIPE_WEBHOOK_SECRET`) or malicious traffic.

Suggested pattern:

```
{ $.msg = "request failed" && $.err.message = "Invalid input" }
```

Notes:

- Improve precision by matching route and error detail if you enrich logs.

Metric:

- Namespace: `Agrobridge/Backend`
- Name: `StripeWebhookSignatureFailures`

Alarm (paging):

- Trigger: > 5 in 5 minutes AND donation volume is non-zero

## Metric Filter 3: Slow DB Operations

Purpose:

- Detect DB regressions early.

Trigger source:

- The code logs a warning with message `slow db operation` when `db.duration_ms >= DB_SLOW_MS`.

Filter pattern:

```
{ $.msg = "slow db operation" }
```

Metric:

- Namespace: `Agrobridge/Backend`
- Name: `SlowDbOps`

Alarm (ticket):

- Trigger: sum over 15 minutes > 50 (tune after baselining)

Runbook:

- Use `traceId` in the log event to open the corresponding trace and identify the slow path.

## Metric Filter 4: Auth Failures (Admin)

Purpose:

- Detect brute-force attempts or cookie misconfiguration.

Suggested pattern:

```
{ $.err.code = "UNAUTHORIZED" }
```

Metric:

- Namespace: `Agrobridge/Backend`
- Name: `Unauthorized`

Alarm (ticket):

- Trigger: spike over baseline

## Alarm Hygiene

- Page only when likely user impact exists.
- Prefer ticket alarms for slow DB ops and auth spikes.
- Tie paging to symptoms that affect donation flow or webhook processing.
