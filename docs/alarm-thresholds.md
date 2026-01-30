# Alarm Thresholds and Runbook Mapping

This document provides concrete initial thresholds for alarms and explicitly links each alarm to the relevant runbook sections.

Important:

- These are initial defaults.
- After 2-4 weeks of production traffic, recalibrate thresholds based on observed baselines.

## Paging vs Ticketing

- Page when there is clear user impact or high likelihood of imminent impact.
- Ticket when it indicates a degradation trend but not urgent user-facing failure.

## Alarm Table (Initial Defaults)

### 1) ALB Target 5xx Rate (Paging)

Signal:

- ALB target 5xx responses.

Initial threshold:

- 5xx rate > 1% for 5 minutes.

Runbook:

- `README.md` -> Runbooks -> Elevated 500s
- `docs/incident-template.md`

Notes:

- If donation campaigns are running, treat lower thresholds as SEV-1.

### 2) Stripe Webhook Failures (Paging)

Signals:

- Log metric `StripeWebhookSignatureFailures` spike.
- Stripe dashboard shows delivery failures.
- `WebhookEvent.processed=false` backlog growth.

Initial thresholds:

- Signature failures: >= 5 in 5 minutes
- 5xx on webhook endpoint: >= 1% for 5 minutes

Runbook:

- `README.md` -> Runbooks -> Stripe Webhooks Failing
- `docs/deployment-runbook.md`

### 3) Donation Freshness Regression (Ticket -> Page if severe)

Signal:

- Donations remain `PENDING` longer than normal.

Initial threshold:

- Median time-to-terminal-state > 5 minutes for 60 minutes.

Escalation:

- Page if > 10 minutes for 30 minutes OR donor complaints exist.

Runbook:

- `README.md` -> Runbooks -> Donations Stuck in PENDING

### 4) DB Connectivity / Connection Exhaustion (Paging)

Signals:

- RDS `DatabaseConnections` near max.
- Prisma connection errors in logs.

Initial thresholds:

- Connection errors: >= 5 in 5 minutes
- RDS connections > 85% of max for 5 minutes

Runbook:

- `README.md` -> Runbooks -> Elevated 500s
- `docs/load-capacity.md` -> DB bottleneck

### 5) Slow DB Operations (Ticket)

Signal:

- Log metric `SlowDbOps` where `msg="slow db operation"`.

Initial thresholds:

- > 50 events in 15 minutes (tune with baseline)

Operational procedure:

- Use `traceId` on the log event to open trace and identify hot path.

Runbook:

- `docs/cloudwatch-queries.md`
- `docs/load-capacity.md`

### 6) Admin Auth Failures Spike (Ticket)

Signal:

- `Unauthorized` metric spike.

Initial thresholds:

- > 100 unauthorized responses in 15 minutes (adjust based on traffic)

Runbook:

- `README.md` -> Runbooks -> Admin Login Always Returns 401
- `docs/security-rotation.md` (cookie/jwt secret rotation impact)

## How to Tune Thresholds

1. Establish baselines

- Collect 2 weeks of normal traffic.
- Compute mean and p95 for each metric.

2. Set alert thresholds

- For ticket alerts: baseline + (3x)
- For paging alerts: baseline + (10x) or absolute thresholds indicating impact

3. Use burn rate for SLOs

- Adopt multi-window burn rate alerts for availability and latency.

## Checklist for Adding a New Alarm

- Is it user-impacting?
- Is it actionable?
- Does it have a runbook link?
- Is the signal low-noise?
