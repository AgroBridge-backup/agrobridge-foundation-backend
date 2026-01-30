# Ownership and Escalation

This document defines who owns the service, who gets paged, and how escalation works.

## Service Ownership

Primary owner:

- Agrobridge Foundation Engineering

Secondary stakeholders:

- Product/Operations (donation campaigns)

## On-call Model

Recommended MVP model:

- Primary on-call: 1 engineer per week
- Secondary on-call: backup engineer per week
- Incident commander: the primary on-call until delegated

Escalation philosophy:

- Page for user impact or high likelihood of impact.
- Create tickets for slow burns or non-urgent improvements.

## Severity Levels

### SEV-1 (Critical)

Definition:

- Donations are blocked or failing at high rate.
- Stripe webhooks are failing (donations stuck PENDING) with clear donor impact.
- Database is unavailable.

Response targets:

- Acknowledge: 5 minutes
- Mitigate: 30 minutes

### SEV-2 (High)

Definition:

- Partial degradation:
  - elevated 5xx < SEV-1 threshold
  - latency p95 above SLO for extended period
  - admin features degraded

Response targets:

- Acknowledge: 15 minutes
- Mitigate: 2 hours

### SEV-3 (Moderate)

Definition:

- No immediate user impact, but correctness or reliability risk:
  - increased 4xx due to misconfiguration
  - non-critical background errors

Response targets:

- Acknowledge: business day

## Paging Triggers (Examples)

Page immediately:

- ALB 5xx rate > 1% for 5 minutes
- Stripe webhook failures spike or backlog grows
- RDS connection errors spike

Ticket:

- p95 latency regression for 30+ minutes
- donation freshness regression without confirmed donor impact

## Communication

During SEV-1/2:

- Open an incident channel
- Post updates every 15 minutes
- Record timeline in `docs/incident-template.md`

External comms:

- If donation flow is affected, notify foundation operations quickly.

## Rollback Policy

Default policy:

- If a new deploy correlates with errors and rollback is low risk: rollback early.

Rollback criteria:

- clear regression in 5xx or webhook processing
- inability to mitigate via config within 15 minutes (SEV-1)

## Runbook Index

- SLOs and alarms: `docs/slo-alarms.md`
- Incident template: `docs/incident-template.md`
- Deployment runbook: `docs/deployment-runbook.md`
- Golden paths: `docs/golden-path.md`
