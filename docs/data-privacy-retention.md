# Data Privacy and Retention Policy

This document defines how the service handles PII, how long data is retained, and how access is controlled.

Scope:

- Donation and contact form data
- Stripe webhook payload storage
- Admin user data

Non-goals:

- Formal legal compliance documentation (this is an engineering policy baseline; legal counsel should review before broad launch).

## Data Inventory

### Donation

Fields:

- `donorEmail` (PII)
- `amount`, `currency` (financial metadata; not card data)
- `stripeSessionId` (identifier)
- `metadata` (potentially sensitive depending on content)

Notes:

- Do not store any card details. All payment processing is handled by Stripe.

### ContactRequest

Fields:

- `name` (PII)
- `email` (PII)
- `message` (may contain sensitive content)

### WebhookEvent

Fields:

- `rawPayload` (may include email or identifiers)

Risk:

- Raw payloads are valuable for forensics and idempotency, but increase data retention scope.

### AdminUser

Fields:

- `email` (PII)
- `passwordHash` (sensitive)

## Data Minimization

Policy:

- Only collect fields needed for the MVP and operational reliability.
- Avoid storing optional data unless it is required for product or operations.

Guidelines:

- Keep `metadata` keys controlled; do not allow arbitrary sensitive data from clients.
- Consider enforcing an allowlist for `metadata` keys if the frontend is not fully trusted.

## Retention Windows (Recommended Defaults)

These defaults are pragmatic and should be tuned with legal requirements.

- Donations:
  - Retain indefinitely for accounting/audit requirements, unless policy requires deletion.

- Contact requests:
  - Retain 12 months, then archive or delete.

- Webhook events:
  - Retain 30-90 days.
  - Long enough for:
    - debugging Stripe delivery issues
    - dispute investigations
    - operational forensics

- Admin users:
  - Retain while employed/authorized.
  - Disable rather than delete for audit trail (role changes, last login).

## Access Control

- Production DB access should be limited.
- Use least privilege:
  - app user: only necessary CRUD
  - admin read-only user: for debugging

Operational rules:

- No direct production DB access from local machines unless approved.
- All access should be logged (CloudTrail, RDS logs, or bastion session logs).

## Logging and PII

Policy:

- Never log passwords, password hashes, cookies, or auth headers.
- Avoid logging raw webhook payloads.

Implementation notes:

- `src/config/logger.ts` uses redaction for cookies/auth.
- Raw webhook payload is persisted in DB for idempotency/forensics; it should not be emitted to logs.

## Deletion Requests / DSAR (Engineering Procedure)

If a donor requests deletion:

- Determine what constitutes PII:
  - donorEmail
  - contact name/email/message

Recommended engineering actions:

- Donations:
  - if legal/accounting requires retention, pseudonymize:
    - set `donorEmail = null`
    - remove PII from `metadata`
- ContactRequest:
  - delete the record or redact fields depending on policy
- WebhookEvent:
  - redact payloads for specific event IDs if they contain PII

Document the request:

- who requested
- what was deleted/redacted
- when it was completed

## Data Security Requirements

- Encrypt at rest: RDS encryption enabled
- Encrypt in transit: TLS to RDS
- Secrets stored in Secrets Manager
- Regular backups + PITR

## Future Enhancements

- Automated retention jobs:
  - periodic deletion of old webhook events and contact requests
- Metadata allowlist
- Audit log table for admin access to sensitive operations
