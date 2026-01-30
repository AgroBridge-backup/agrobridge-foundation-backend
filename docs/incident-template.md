# Incident Template

Use this template during any incident. Keep it factual, timestamped, and focused on mitigation.

## Header

- Incident title:
- Severity (SEV-1/2/3):
- Start time (UTC):
- Detected by:
- Commander:
- Communications lead:
- Primary on-call:
- Status: Investigating | Mitigating | Monitoring | Resolved

## Impact

- User impact:
  - Donations blocked? (yes/no)
  - Donations stuck pending? (yes/no)
  - Admin dashboard down? (yes/no)
- Scope:
  - region(s):
  - % traffic affected:
- Revenue impact estimate:

## Timeline (UTC)

- T+00: Detection
- T+05: Initial triage
- T+XX: Mitigation step 1
- T+XX: Mitigation step 2
- T+XX: Recovery confirmed

## Current Hypothesis

- Working theory:
- Evidence:
  - logs (requestId examples):
  - metrics:
  - recent deploy:

## Mitigation Actions

- Immediate mitigation:
  - rollback? (yes/no)
  - feature disable? (yes/no)
  - traffic shift? (yes/no)

- Steps executed:
  1.
  2.
  3.

## Verification

- Health check:
  - `GET /api/health`:
- Donation intent:
  - `POST /api/donations/intent`:
- Webhook processing:
  - Stripe dashboard deliveries:
  - DB `WebhookEvent.processed=true`:
- Admin dashboard:
  - `GET /api/admin/dashboard`:

## Root Cause (Post-Resolution)

- Root cause:
- Contributing factors:
- Detection gaps:
- What went well:
- What didn’t:

## Corrective Actions

- Code fixes:
- Configuration changes:
- Monitoring/alerts:
- Runbook updates:

## Prevent Recurrence

- Permanent fix:
- Test coverage additions:
- Postmortem date:

## Attachments

- CloudWatch dashboard links:
- Relevant PR/commit:
- Stripe webhook logs:
- SQL queries used:
