# Design Decisions

This document captures key engineering decisions and the rationale behind them.

## Amounts Stored as Minor Units (Int)

Decision:

- Persist donation amounts as integers in minor units (e.g., cents).

Why:

- Stripe uses integer `unit_amount`.
- Prevents rounding issues and keeps accounting exact.

Tradeoffs:

- Requires formatting on the frontend.

## JWT in Signed httpOnly Cookie

Decision:

- Store admin JWT in a signed, httpOnly cookie with 24h expiry.

Why:

- Cookie storage avoids localStorage token exfiltration via XSS.
- `httpOnly` blocks JavaScript access.
- Signed cookies prevent tampering.

Tradeoffs:

- Cross-site scenarios require careful CORS + SameSite settings.

## Webhook Idempotency via WebhookEvent

Decision:

- Persist Stripe webhook `event.id` in `WebhookEvent` and do not reprocess duplicates.

Why:

- Stripe retries webhooks.
- Network retries and client behavior can duplicate deliveries.
- Durable idempotency key enables safe replays.

## Validation at the Boundary

Decision:

- Validate all incoming payloads and query strings.

Why:

- Never trust input.
- Keeps route handlers thin and error handling consistent.

## Integration Tests Against Real Postgres

Decision:

- Run integration tests with Testcontainers + Postgres.

Why:

- SQL and migrations are a common source of production defects.
- Real DB tests surface indexing, constraints, and transaction issues.

## Observability: DB Spans Without SQL/PII

Decision:

- Emit explicit DB spans around repository calls without attaching SQL or user data.

Why:

- Helps identify slow queries and hot paths in production.
- Avoids leaking PII or high-cardinality attributes.

How:

- Repositories wrap Prisma calls in `withDbSpan` and emit:
  - model (`Donation`, `WebhookEvent`, etc)
  - operation (`create`, `update`, `findMany+count`, etc)
  - duration
