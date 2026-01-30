# SLOs and Alarms

This document defines service-level objectives (SLOs), the indicators (SLIs) used to measure them, and a practical alarm strategy.

Scope (MVP):

- Public API endpoints
- Admin endpoints
- Stripe webhook ingestion

Non-goals:

- Perfect global correctness metrics (we start with high-signal SLIs that are easy to measure).

## Definitions

- SLI (Service Level Indicator): what we measure (latency, success rate, freshness).
- SLO (Service Level Objective): the target for the SLI over a time window.
- Error budget: allowed amount of SLI failure within the SLO window.

## SLIs

### SLI-1: API Request Success Rate

Definition:

- Percentage of HTTP requests with status code < 500.

Notes:

- 4xx are excluded from failure because they represent rejected client input.
- Track separately for:
  - public endpoints (`/api/health`, `/api/contacts`, `/api/donations/intent`)
  - admin endpoints (`/api/admin/*`)

### SLI-2: API Latency (p95)

Definition:

- 95th percentile response time by route group.

Track separately:

- Public endpoints
- Admin endpoints
- Stripe webhook endpoint

### SLI-3: Stripe Webhook Processing Success

Definition:

- Percentage of Stripe webhook deliveries that result in:
  - HTTP 200
  - and `WebhookEvent.processed = true`

Rationale:

- HTTP 200 alone is not sufficient; we also want durable processing.

### SLI-4: Donation Freshness

Definition:

- Time from Donation creation to terminal state (SUCCEEDED/EXPIRED).

Rationale:

- Captures a real user impact: donors pay but donation stays pending.

## Proposed SLOs

These are pragmatic MVP targets. Tighten after 2-4 weeks of real traffic baselining.

### SLO-1: Availability / Success

Window:

- 30 days

Targets:

- Public endpoints: 99.9% requests < 500
- Admin endpoints: 99.5% requests < 500
- Stripe webhook endpoint: 99.9% requests < 500

### SLO-2: Latency

Window:

- 30 days

Targets:

- Public endpoints p95 < 500ms
- Admin endpoints p95 < 750ms
- Stripe webhook endpoint p95 < 750ms

### SLO-3: Webhook Processing

Window:

- 30 days

Targets:

- 99.9% of delivered webhooks are persisted and marked processed within 60 seconds.

## Alarm Strategy

Principle: page only when user impact is likely; create non-paging tickets for slow-burn issues.

### Paging Alarms (Immediate Action)

1. ALB 5xx rate high

- Trigger: 5xx rate > 1% for 5 minutes
- Action: page on-call

2. API success SLO burn rate

- Trigger: multi-window burn rate (example):
  - fast burn: 2% error budget burned in 1 hour
  - slow burn: 5% error budget burned in 6 hours
- Action: page on-call for fast burn; ticket for slow burn

3. Stripe webhook failures

- Trigger:
  - webhook endpoint 4xx/5xx spike (signature failures or server errors)
  - or `WebhookEvent.processed=false` growth (backlog)
- Action: page on-call

4. RDS unavailable / connections exhausted

- Trigger:
  - DB connection errors in logs > threshold
  - or RDS `DatabaseConnections` near max for 5+ minutes
- Action: page on-call

### Ticket Alarms (Non-Paging)

- Latency p95 regression
  - Trigger: p95 above target for 30 minutes
- Donation freshness regression
  - Trigger: median pending time exceeds 5 minutes over 1 hour
- Auth failures rising
  - Trigger: 401 spike on `/api/auth/login` without corresponding traffic spike
- Slow DB spans
  - Trigger: spikes in log line `msg="slow db operation"` over 15 minutes
  - Notes: correlate by `traceId` for root cause

## Alarm Thresholds

See `docs/alarm-thresholds.md` for initial default thresholds and explicit runbook mapping.

## CloudWatch Implementation Notes

### Log-based metric filters

See `docs/cloudwatch-metric-filters.md` for suggested CloudWatch Logs metric filters, including `slow db operation`.

### Metrics sources

- ALB metrics:
  - `HTTPCode_Target_5XX_Count`
  - `TargetResponseTime`
  - `RequestCount`

- ECS metrics:
  - `CPUUtilization`, `MemoryUtilization`
  - task restart count

- RDS metrics:
  - `CPUUtilization`, `FreeStorageSpace`, `DatabaseConnections`, `FreeableMemory`

### Log-based metric filters

Use CloudWatch Logs Insights + metric filters for:

- count of `INTERNAL_ERROR`
- count of webhook signature failures
- count of prisma connection errors

See `docs/cloudwatch-queries.md` for query pack.

## Ownership

- Product owner: Foundation engineering
- On-call: rotate weekly
- Escalation: if payments or webhooks are impacted, escalate immediately (donation revenue risk)
