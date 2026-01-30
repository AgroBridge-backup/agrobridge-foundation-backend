# Secret Rotation Strategy

This document describes how to rotate secrets safely without breaking users unexpectedly.

## Secrets

- `JWT_SECRET` (signs JWT tokens)
- `COOKIE_SECRET` (signs cookies; also used by @fastify/cookie signer)
- `STRIPE_WEBHOOK_SECRET` (validates webhook signatures)
- `STRIPE_SECRET_KEY` (Stripe API)

## Rotation Impact

### COOKIE_SECRET

Impact:

- Rotating invalidates all existing signed cookies immediately.
- Users will need to re-login.

Safe rollout options:

- Prefer rotating during planned maintenance windows.
- If multi-secret verification is required, implement a keyring approach:
  - verify using [old, new]
  - sign using new

### JWT_SECRET

Impact:

- Rotating invalidates all existing JWTs.
- Users will need to re-login.

Safe rollout options:

- Similar keyring approach:
  - verify with old+new
  - sign with new
- Keep overlap window short.

### STRIPE_WEBHOOK_SECRET

Impact:

- Wrong secret causes webhook signature verification failures.
- Donations may remain PENDING until fixed.

Safe rollout options:

- Update Stripe endpoint secret and app secret in a coordinated change.
- After rotation, replay failed events from Stripe dashboard.

### STRIPE_SECRET_KEY

Impact:

- Wrong secret breaks Checkout Session creation.

Safe rollout options:

- Use Stripe restricted keys.
- Roll out with canary deploy and verify `POST /api/donations/intent`.

## Recommended Operational Procedure

1. Create new secret value in Secrets Manager.
2. Deploy application with dual-verify (keyring) if supported.
3. Monitor auth failure rates and webhook failures.
4. Switch to signing with new key.
5. After overlap window, remove old key.

## Notes

Current codebase uses a single key for JWT and cookie signing. If you want zero-downtime rotation, we should implement a keyring verification strategy.
