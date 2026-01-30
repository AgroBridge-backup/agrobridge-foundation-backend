# API Examples

Base URL:

- Local: `http://localhost:3000`

All responses use a consistent envelope:

- Success: `{ ok: true, data: ... }`
- Error: `{ ok: false, error: { code, message, details? } }`

## Health

Request:

```bash
curl -sS http://localhost:3000/api/health
```

Response:

```json
{ "ok": true, "data": { "status": "ok" } }
```

## Auth: Admin Login

Request:

```bash
curl -i -sS -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"admin@agrobridge.org","password":"change-me"}'
```

Success (200):

- `Set-Cookie: ab_admin=...; HttpOnly; SameSite=Lax; Path=/`

Body:

```json
{ "ok": true, "data": {} }
```

Failure (401):

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Unauthorized" } }
```

## Contacts

Request:

```bash
curl -sS -X POST http://localhost:3000/api/contacts \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","message":"Hello"}'
```

Success (201):

```json
{ "ok": true, "data": { "id": "<uuid>" } }
```

Validation error (422):

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": {} } }
```

## Donations: Create Intent

Request:

```bash
curl -sS -X POST http://localhost:3000/api/donations/intent \
  -H 'content-type: application/json' \
  -d '{"amount":5000,"currency":"usd","donorEmail":"donor@example.com","metadata":{"campaign":"mvp"}}'
```

Success (200):

```json
{ "ok": true, "data": { "sessionId": "cs_...", "url": "https://checkout.stripe.com/..." } }
```

Validation error (422):

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": {} } }
```

## Stripe Webhook

Signature is mandatory. Recommended local workflow:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

Missing signature (400):

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Missing stripe-signature" } }
```

Invalid signature (400):

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid Stripe signature" } }
```

## Admin: List Donations

Request:

```bash
curl -sS 'http://localhost:3000/api/admin/donations?page=1&pageSize=25&status=SUCCEEDED&sort=createdAt:desc' \
  -b cookies.txt
```

Success (200):

```json
{
  "ok": true,
  "data": {
    "items": [],
    "meta": { "page": 1, "pageSize": 25, "total": 0, "totalPages": 1 }
  }
}
```

Unauthorized (401):

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "Unauthorized" } }
```

## Admin: Dashboard

Request:

```bash
curl -sS http://localhost:3000/api/admin/dashboard \
  -b cookies.txt
```

Success (200):

```json
{
  "ok": true,
  "data": {
    "totalRaised": 0,
    "donationCount": 0,
    "donorCount": 0,
    "lastDonationAt": null
  }
}
```
