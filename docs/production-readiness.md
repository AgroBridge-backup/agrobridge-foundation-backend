# Production Readiness Review (PRR)

This checklist is a gate before any production launch. The goal is to reduce the probability of avoidable incidents.

How to use:

- For each section: mark Pass/Fail/Needs Work.
- Any "Fail" in Security, Payments/Webhooks, or Data should block launch.

## 1) Service Overview

- Service name:
- Primary user journeys:
  - Donation intent -> Stripe checkout -> webhook -> donation succeeds
  - Admin login -> admin dashboard
- Dependencies:
  - Postgres (RDS)
  - Stripe API + Stripe webhooks
- Data classification:
  - PII: donorEmail, contact email
  - Payment data: handled by Stripe (do not store card data)

## 2) Security

Pass/Fail items:

- Secrets stored in a secret manager (not in env files committed to repo)
  - `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- CORS is strict allowlist; no wildcard in production
- Admin auth:
  - cookie is `httpOnly`
  - cookie is `secure` in production
  - `sameSite=lax`
  - JWT expiry is 24h
- Rate limiting enabled in production
- Logging redaction confirmed (cookies, auth headers, password/passwordHash)
- Database credentials are least privilege
- No sensitive data is logged (especially webhook payloads)

## 3) Payments / Webhooks (Stripe)

Pass/Fail items:

- `POST /api/donations/intent`:
  - amount validation is strict (positive integer minor units)
  - donation persisted before external call (traceability)
  - Stripe metadata includes `donationId` + `source`
- `POST /api/webhooks/stripe`:
  - signature validation is enforced
  - raw payload is persisted
  - idempotency is enforced by Stripe `event.id`
  - completed/expired transitions are correct and covered by tests
- Replay procedure is documented (Stripe dashboard replay)

## 4) Data and Schema

Pass/Fail items:

- Prisma schema matches intended domain model
- Migrations applied in production pipeline
- Backups + PITR enabled for RDS
- Data retention decision documented:
  - webhook raw payload retention window
  - contact request retention window

## 5) Reliability and Observability

Pass/Fail items:

- Health check endpoint exists and is used by ALB: `GET /api/health`
- Request IDs are included and searchable in logs
- Dashboards exist:
  - ALB 5xx, latency
  - ECS CPU/memory
  - RDS connections/CPU
  - webhook failures
- Alerts configured per `docs/slo-alarms.md`

## 6) Testing and Rollout

Pass/Fail items:

- Unit tests cover services (validation + error paths)
- Integration tests cover routes with real Postgres (Testcontainers) in CI
- Coverage gate enforced for `src/services/`, `src/webhooks/`, `src/api/routes/`
- Release strategy:
  - canary or rolling deploy
  - rollback criteria are explicit

## 7) Operational Readiness

Pass/Fail items:

- On-call schedule defined
- Escalation policy defined (see `docs/ownership-escalation.md`)
- Runbooks available and linked:
  - webhook failures
  - auth failures
  - DB connectivity
- Incident template exists and the team knows how to use it

## 8) Cost and Limits

Pass/Fail items:

- ECS task sizing selected and auto-scaling rules set
- RDS instance sized for expected load
- Stripe usage is monitored (API calls)

## Sign-off

- Engineering:
- Security:
- Product:
- Date:
