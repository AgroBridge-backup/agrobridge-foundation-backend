# Golden Path Walkthroughs

This doc describes the highest-signal end-to-end flows, what to expect at each step, and what should be persisted.

Assumptions:

- API base URL: `http://localhost:3000`
- DB is running and migrations applied.

## Flow 1: Donation Intent -> Checkout -> Webhook -> Admin Metrics

### Step 1: Create intent

Request:

```bash
curl -sS -X POST http://localhost:3000/api/donations/intent \
  -H 'content-type: application/json' \
  -d '{"amount":5000,"currency":"usd","donorEmail":"donor@example.com","metadata":{"campaign":"mvp"}}'
```

Expected HTTP response (200):

```json
{ "ok": true, "data": { "sessionId": "cs_...", "url": "https://checkout.stripe.com/..." } }
```

Expected DB changes:

- `Donation` row created:
  - `status = PENDING`
  - `amount = 5000`
  - `currency = "usd"`
  - `donorEmail = "donor@example.com"`
  - `stripeSessionId = <sessionId returned by Stripe>`
  - `metadata` contains:
    - `donationId`
    - `source = "agrobridgefoundation.org"`
    - any extra metadata you provided (stringified)

### Step 2: Donor completes Checkout

This happens on Stripe-hosted pages. On success, Stripe delivers:

- `checkout.session.completed` webhook

### Step 3: Webhook updates donation

Expected webhook behavior:

- Signature verified (`stripe-signature`)
- Webhook persisted (`WebhookEvent.id = event.id`)
- Donation status updated:
  - `PENDING -> SUCCEEDED` for `checkout.session.completed`

Expected DB changes:

- `WebhookEvent` inserted (idempotency key):
  - `id = evt_...`
  - `type = "checkout.session.completed"`
  - `processed = true`
  - `rawPayload` stored
- `Donation` updated:
  - `status = SUCCEEDED`

### Step 4: Admin dashboard reflects metrics

Request:

```bash
curl -sS http://localhost:3000/api/admin/dashboard \
  -b cookies.txt
```

Expected:

- `totalRaised` includes the succeeded donation amount.
- `donorCount` includes the donor email if present.

## Flow 2: Webhook Idempotency (Replay Safe)

Purpose:

- Verify duplicate deliveries do not duplicate side-effects.

Steps:

1. Deliver the same webhook event twice (same Stripe `event.id`).
2. Expected:
   - first delivery inserts `WebhookEvent` and processes
   - second delivery returns 200 without reprocessing

DB invariant:

- Exactly one `WebhookEvent` row exists per `event.id`.

## Flow 3: Admin Login -> Cookie -> Admin Access

### Step 1: Login

```bash
curl -i -sS -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"admin@agrobridge.org","password":"change-me"}'
```

Expected:

- `Set-Cookie: ab_admin=...; HttpOnly; SameSite=Lax; Path=/`
- Response body: `{ "ok": true, "data": {} }`

### Step 2: Access an admin endpoint

```bash
curl -sS http://localhost:3000/api/admin/donations?page=1&pageSize=25 \
  -b cookies.txt
```

Expected:

- 200 response

Negative test:

- Without cookie, you should get 401 with `{ ok: false, error: { code: "UNAUTHORIZED" ... } }`.
