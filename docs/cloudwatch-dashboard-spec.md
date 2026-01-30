# CloudWatch Dashboard Spec

This document defines the minimum viable CloudWatch dashboard for operating the backend in production.

Goals:

- One dashboard answers: "Is the donation flow healthy?"
- Fast detection of incidents and fast root cause isolation.

Scope:

- ALB
- ECS service
- RDS Postgres
- Log-based metrics (app)

Non-goals:

- A perfect observability solution (this is the baseline; expand after traffic baselining).

## Dashboard: "Agrobridge Backend - Prod"

Time range presets:

- Last 15 minutes (incident)
- Last 3 hours (regression)
- Last 24 hours (trend)

## Section A: Service Health (Top Row)

1. ALB Requests + 5xx Rate

- Metrics:
  - ALB `RequestCount`
  - ALB target 5xx count (`HTTPCode_Target_5XX_Count`)
- Visualization:
  - request count (line)
  - 5xx count (line)
- Notes:
  - this is your primary availability signal

2. Target Response Time (p50/p95)

- Metrics:
  - ALB `TargetResponseTime` (p50, p95)
- Notes:
  - helps separate app slowness vs upstream issues

3. Health Check Status

- Metrics:
  - ALB target health (healthy host count)
- Notes:
  - should always be >= 2 tasks

## Section B: Donation Critical Path

4. Donation Intent Success/Failures

- Source:
  - ALB status code counts for `/api/donations/intent`
  - or log-based metric filter on errors for that route
- Visuals:
  - stacked counts by status class (2xx/4xx/5xx)

5. Stripe Webhook Success/Failures

- Metrics:
  - log metric `StripeWebhookSignatureFailures`
  - ALB 5xx for `/api/webhooks/stripe`
- Notes:
  - this is the fastest indicator of "donations stuck pending" risk

6. Donation Freshness Proxy

- MVP proxy:
  - webhook failures + pending backlog detection
- Phase 2:
  - custom metric: time-to-terminal-state histogram (recommended)

## Section C: Database Health

7. RDS Connections

- Metrics:
  - RDS `DatabaseConnections`
- Notes:
  - look for spikes or steady-state near max

8. RDS CPU + Freeable Memory

- Metrics:
  - RDS `CPUUtilization`
  - RDS `FreeableMemory`

9. RDS Storage

- Metrics:
  - RDS `FreeStorageSpace`

10. Slow DB Ops (Log Metric)

- Metrics:
  - log metric `SlowDbOps`
- Notes:
  - correlate spikes with traces using `traceId`

## Section D: ECS / Application

11. ECS CPU + Memory

- Metrics:
  - ECS service `CPUUtilization`
  - ECS service `MemoryUtilization`

12. Task Count / Restarts

- Metrics:
  - running task count
  - deployment events / restarts (CloudWatch Events / ECS service events)

13. Application Internal Errors

- Metrics:
  - log metric `InternalErrors`

## Section E: Auth and Admin

14. Unauthorized Spike

- Metrics:
  - log metric `Unauthorized`
- Notes:
  - helps detect brute-force attempts or cookie secret misconfiguration

15. Admin endpoint latency

- Source:
  - ALB target response time filtered by `/api/admin/*` (if available)
  - otherwise log insights query and periodic review

## Widget Layout Recommendation

- Row 1 (Health): widgets 1-3
- Row 2 (Donations): widgets 4-6
- Row 3 (DB): widgets 7-10
- Row 4 (ECS/App): widgets 11-13
- Row 5 (Auth/Admin): widgets 14-15

## Runbook Links

- Alarm thresholds: `docs/alarm-thresholds.md`
- SLOs and alarms: `docs/slo-alarms.md`
- CloudWatch queries: `docs/cloudwatch-queries.md`
- Metric filters: `docs/cloudwatch-metric-filters.md`
- Incident template: `docs/incident-template.md`

## Implementation Notes

- Prefer to tag resources by environment (`env=prod`) so dashboards can be templatized.
- Keep widget titles consistent and explicit.
- Avoid high-cardinality dimensions.
