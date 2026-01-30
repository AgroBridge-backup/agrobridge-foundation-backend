# Prio 1 Implementation Notes (FAANG-Level)

This document provides detailed engineering documentation for the Prio 1 work delivered. It is written for production readiness reviews (PRR), security reviews, and on-call handoffs.

## Executive Summary

Prio 1 focused on platform hygiene, security baselines, and dependency hardening. The changes are strictly backward compatible and target request safety, observability of failures, and predictable operation under load.

Key outcomes:

- Linting is restored under ESLint v9 flat config.
- Dependencies updated to requested baseline versions.
- Request body size limits enforced for JSON and raw webhook payloads.
- Rate limiting applied globally and tightened for Stripe webhooks.
- Security headers tightened (CSP, HSTS).
- CORS supports a strict allowlist with multiple origins.
- Prisma connection pooling is enforced to avoid unbounded connections.
- Stripe API version is now externally configurable.
- Webhook signature failures are surfaced consistently.
- Removed unsafe `as any` from runtime paths.

## Change Map

- `eslint.config.js`: New flat config.
- `package.json`: Dependency upgrades and ESLint support packages.
- `.env.example`: Added `STRIPE_API_VERSION` and clarified CORS usage.
- `src/app.ts`: JSON body limit, raw body limit, CSP/HSTS, CORS allowlist, rate limit default, Stripe API version.
- `src/api/routes/webhooks-stripe.ts`: Per-route rate limit; signature error handling.
- `src/db/prisma.ts`: Pooling params on datasource URL.
- `src/config/env.ts`: `STRIPE_API_VERSION` and comma-separated CORS.
- `src/repositories/donation-repo.ts`: Prisma JSON typing.
- `docs/api-examples.md`: Webhook invalid signature response example.

## Environment Changes

New required variable:

```
STRIPE_API_VERSION=2024-06-20
```

CORS now accepts a comma-separated allowlist:

```
CORS_ORIGIN=https://agrobridgefoundation.org,https://admin.agrobridgefoundation.org
```

Note: the first origin is used to build the Stripe checkout success/cancel URLs.

## Implementation Details

Each section below includes before/after, rationale, operational impact, risks, tests, and rollback guidance.

### 1) ESLint Migration to Flat Config

Files:

- `eslint.config.js`
- `package.json`

Before:

```js
// Legacy .eslintrc.cjs (ignored by ESLint v9 by default)
module.exports = { extends: ['eslint:recommended', 'plugin:import/recommended', 'prettier'] };
```

After:

```js
// eslint.config.js
export default [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  { ...js.configs.recommended, rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off' } },
  { files: ['**/*.ts'], languageOptions: { parser: tsParser }, rules: { 'no-undef': 'off' } },
  { files: ['**/*.{js,ts}'], plugins: { import: importPlugin }, rules: { 'import/order': ['error', { alphabetize: { order: 'asc' } }] } },
  { files: ['**/*.ts'], plugins: { '@typescript-eslint': tsPlugin }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['**/*.{js,ts}'], rules: { 'no-unused-vars': 'off' } },
  prettier,
];
```

Why:

- ESLint v9 ignores `.eslintrc.*` by default; linting was effectively disabled.

Operational impact:

- CI linting is restored and consistent across environments.

Risks and mitigations:

- Import ordering is enforced; auto-fix is available.

Tests:

```
npm run lint
```

Rollback:

- Revert `eslint.config.js` and restore ESLint v8 or enable legacy config explicitly.

### 2) Dependency Updates (Prisma, Stripe, Zod, bcryptjs)

Files:

- `package.json`
- `package-lock.json`

Before:

```json
"@prisma/client": "^5.20.0",
"prisma": "^5.20.0",
"stripe": "^16.2.0",
"zod": "^3.23.8",
"bcryptjs": "^2.4.3"
```

After:

```json
"@prisma/client": "^7.2.0",
"prisma": "^7.2.0",
"stripe": "^20.2.0",
"zod": "^4.3.0",
"bcryptjs": "^3.0.2"
```

Why:

- Security, stability, and supportability upgrades to match the target baseline.

Operational impact:

- Prisma client regeneration is required after install.
- Stripe SDK now uses an explicit API version at initialization.

Risks and mitigations:

- SDK behavior changes across major versions; covered by integration tests for API flows.

Verification:

```
npm install
npx prisma generate
```

Rollback:

- Revert version changes in `package.json` and reinstall.

### 3) Request Body Limits (JSON + Raw Webhook)

Files:

- `src/app.ts`

Before:

```ts
const app = Fastify({ ... });
app.register(rawBody, { field: 'rawBody', global: false });
```

After:

```ts
const jsonBodyLimit = 1_048_576;
app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: jsonBodyLimit }, parseJson);
app.register(rawBody, { field: 'rawBody', global: false, bodyLimit: jsonBodyLimit });
```

Why:

- Enforces a hard ceiling on request size to prevent memory abuse and slow payload attacks.

Operational impact:

- Requests over 1MB will return 413.
- Webhook raw payloads are also limited to 1MB.

Edge cases:

- Empty JSON body now parses as `undefined`. Ensure handlers validate required fields (already enforced by Zod in services).

Tests:

- Existing route/service tests; consider adding explicit 413 tests if required.

Rollback:

- Remove `bodyLimit` and revert to default Fastify behavior.

### 4) Rate Limiting

Files:

- `src/app.ts`
- `src/api/routes/webhooks-stripe.ts`

Global policy:

```ts
app.register(rateLimit, { max: 200, timeWindow: '1 minute', global: env.NODE_ENV !== 'test' });
```

Stripe webhook policy:

```ts
app.post('/webhooks/stripe', {
  config: { rawBody: true },
  rateLimit: { max: 100, timeWindow: '1 minute', skipOnError: true },
}, handler);
```

Why:

- Global rate limiting reduces abuse risk; webhook rate limiting protects a sensitive endpoint.

Operational impact:

- In production, clients are limited to 200 req/min by IP.
- Webhook is stricter but fails open if the limiter fails (avoids missing Stripe events).

Edge cases:

- Stripe CLI tests might hit limiter when replays happen rapidly; use `skipOnError` to avoid block on limiter errors.

Tests:

- Unit tests for webhook remain valid; integration tests cover normal flows.

Rollback:

- Remove route-level `rateLimit` and/or disable global limiter.

### 5) Security Headers (CSP + HSTS)

Files:

- `src/app.ts`

CSP and HSTS:

```ts
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
});
```

Why:

- CSP reduces XSS exposure. HSTS prevents HTTPS downgrade attacks.

Operational impact:

- Browsers will enforce HTTPS for the domain after first secure response.
- External scripts/styles must be explicitly allowlisted in CSP if needed.

Risks:

- CSP can block third-party resources if introduced later without config updates.

Rollback:

- Remove CSP/HSTS options in the Helmet config.

### 6) CORS Multi-Origin Allowlist

Files:

- `src/app.ts`
- `src/config/env.ts`
- `src/api/routes/donations.ts`
- `README.md`

Before:

```ts
if (origin === env.CORS_ORIGIN) return cb(null, true);
```

After:

```ts
const allowedOrigins = env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
if (allowedOrigins.includes(origin)) return cb(null, true);
```

Why:

- Supports multiple frontend origins without weakening the allowlist.

Operational impact:

- `CORS_ORIGIN` now accepts comma-separated values.
- Checkout success/cancel URLs use the first origin in the list.

Risks:

- Invalid or malformed entries could lead to unexpected rejections; ensure each entry is a valid URL.

Rollback:

- Revert to strict single-origin comparison.

### 7) Prisma Connection Pooling

Files:

- `src/db/prisma.ts`

Before:

```ts
new PrismaClient({ log: ... });
```

After:

```ts
const pooledUrl = `${baseUrl}${hasQuery ? '&' : '?'}connection_limit=20&pool_timeout=20`;
new PrismaClient({ datasources: { db: { url: pooledUrl } }, log: ... });
```

Why:

- Prevents connection storms and enforces predictable DB load.

Operational impact:

- Connection pool size is 20 with a 20s timeout.
- If DB limits are lower, reduce the pool size (code change required currently).

Risks:

- Overly small pools can cause latency under heavy concurrent load; monitor DB queueing.

Rollback:

- Remove datasource URL override.

### 8) Stripe API Version via Environment

Files:

- `src/app.ts`
- `src/config/env.ts`
- `.env.example`

Before:

```ts
apiVersion: '2024-06-20'
```

After:

```ts
apiVersion: env.STRIPE_API_VERSION
```

Why:

- Avoids hardcoding and makes version changes explicit and reviewable.

Operational impact:

- `STRIPE_API_VERSION` is now required at startup.

Rollback:

- Revert to hardcoded API version.

### 9) Webhook Signature Error Handling

Files:

- `src/webhooks/stripe-webhook-handler.ts`
- `src/api/routes/webhooks-stripe.ts`
- `docs/api-examples.md`

Before:

```ts
try { return constructEvent(...) } catch { throw Errors.validation({ message: 'Invalid Stripe signature' }) }
```

After:

```ts
try { return constructEvent(...) } catch { throw new Error('Invalid Stripe signature') }
```

And in the route:

```ts
try { await handler.handle(...) } catch (err) {
  if (err instanceof Error && err.message === 'Invalid Stripe signature') {
    reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid Stripe signature' } });
    return;
  }
  throw err;
}
```

Why:

- Provides a consistent 400 response for invalid signatures without leaking stack traces.

Operational impact:

- Easier debugging in Stripe dashboard and logs.

Risks:

- None; the error is still handled as a 400 and does not change idempotency behavior.

Rollback:

- Revert to throwing an `AppError` from the handler.

### 10) Type Safety Cleanup (Runtime)

Files:

- `src/app.ts`
- `src/repositories/donation-repo.ts`

Before:

```ts
(req as any).log = req.log.child({ traceId });
metadata: (input.metadata ?? undefined) as any,
```

After:

```ts
req.log = req.log.child({ traceId });
metadata: input.metadata ?? Prisma.JsonNull,
```

Why:

- Removes unsafe casts in runtime code paths and aligns with strict TypeScript.

Operational impact:

- No runtime behavior change; safer typing and clearer intent.

Rollback:

- Revert to the previous casts (not recommended).

## Security Review Notes

- CSP restricts script/style/image sources to self and data/https where required.
- HSTS is enabled with preload. Ensure ALB/CloudFront is configured for HTTPS before enabling in production.
- Rate limiting is enabled globally; webhook uses a separate policy to reduce abuse risk.
- Request body limits protect against large payload attacks.
- Stripe signature handling returns controlled 400 responses.

## Reliability and Performance Notes

- Prisma pooling provides predictable connection usage under concurrency.
- JSON/body limits cap worst-case memory usage per request.
- Rate limiting adds minimal overhead while preventing abusive traffic spikes.

## Observability

- Existing request logging and OpenTelemetry spans are unchanged.
- Webhook signature failures return 400; they will still be logged by the error handler at `error` level.

## PRR Checklist (FAANG)

### Readiness Gate

- [ ] Dependency upgrades validated in staging
- [ ] CSP/HSTS validated in staging over HTTPS
- [ ] CORS allowlist validated for all frontend origins
- [ ] Stripe webhook signature checks validated with real events
- [ ] Body limit thresholds validated under load test
- [ ] Rate limiting thresholds validated under expected traffic

### Change Risk Assessment Matrix

Risk matrix legend:

- Likelihood: Low / Medium / High
- Impact: Low / Medium / High
- Risk score: derived from Likelihood x Impact

Change inventory:

| Change | Likelihood | Impact | Risk | Notes | Mitigation |
| --- | --- | --- | --- | --- | --- |
| ESLint flat config | Low | Low | Low | Tooling change only | `npm run lint -- --fix` available |
| Dependency upgrades | Medium | Medium | Medium | SDK behavior shifts | Integration tests + staging validation |
| JSON/raw body limit | Low | Medium | Low | 413 on oversized payloads | Documented limit + monitoring 413 |
| Rate limiting | Medium | Medium | Medium | 429 responses under burst | Tune thresholds + exclude 429 from SLA |
| CSP/HSTS | Low | High | Medium | CSP blocks resources | Staging validation + allowlist updates |
| CORS allowlist | Low | Medium | Low | CORS rejects new origin | Add origin to env allowlist |
| Prisma pooling | Low | Medium | Low | Pool size too small | Adjust pool size, monitor saturation |
| Stripe API version | Low | Medium | Low | Misconfigured version | Env validation + staging test |
| Webhook signature errors | Low | Medium | Low | 400 on invalid signature | Stripe CLI validation |
| Type safety cleanup | Low | Low | Low | No runtime change | N/A |

### SLO/SLA Impact

SLO targets (service-level objectives):

- Availability: 99.9% (monthly)
- Latency: p50 < 200ms, p95 < 500ms for API requests
- Error rate: < 0.5% of total requests (5xx)

SLA considerations (service-level agreements):

- A stricter body limit may increase 413 responses for large payloads. This is expected and should not count as SLA breach if clients exceed documented limits.
- Rate limiting may generate 429 responses under sustained traffic spikes. This is expected and should be excluded from SLA error rate if well communicated to clients.
- HSTS changes do not impact API SLA directly but require HTTPS termination correctness.

### Monitoring and Alerting

- Watch for spikes in 413 (body limit) and 429 (rate limit) responses.
- Monitor Stripe webhook 4xx rate for signature failures.
- Monitor DB connection counts and pool saturation.

### On-Call Runbooks

- Incident template: `docs/incident-template.md`
- SLOs and alerts: `docs/slo-alarms.md`
- Alarm thresholds: `docs/alarm-thresholds.md`
- CloudWatch queries: `docs/cloudwatch-queries.md`
- CloudWatch metric filters: `docs/cloudwatch-metric-filters.md`
- Deployment runbook: `docs/deployment-runbook.md`
- Release management: `docs/release-management.md`

### Go/No-Go Gate

Go criteria (all must be true):

- Linting passes under ESLint v9 flat config.
- `npm run test:coverage` passes in CI with Docker available.
- Staging validation completed for Stripe webhooks with real signatures.
- CSP/HSTS verified in staging over HTTPS (no blocked critical resources).
- CORS allowlist validated for all production origins.
- 413/429 rates in staging within acceptable thresholds.
- DB connection pool not saturated under expected load.

No-Go triggers (any one is a stop):

- Stripe webhook failures > 1% in staging.
- 5xx error rate exceeds 0.5% after deployment.
- CSP blocks critical frontend resources.
- DB pool saturation persists for > 5 minutes under normal load.
- Missing or misconfigured `STRIPE_API_VERSION`.

Future developer guidance:

- If adding new origins, update `CORS_ORIGIN` and validate with staging tests.
- If increasing payload sizes, update body limits and add a 413 test.
- If modifying rate limits, update the risk matrix and SLO/SLA section.
- Always update `docs/api-examples.md` when changing error behavior.

## Testing and Verification

Commands:

```
npm install
npx prisma generate
npm run lint
npm run test:coverage
```

Notes:

- `npm run test:coverage` requires Docker Desktop for Testcontainers.

## Rollout Plan (Recommended)

1. Deploy to staging with `STRIPE_API_VERSION` set.
2. Verify:
   - `POST /api/donations/intent` returns a Stripe Checkout URL.
   - Webhook events succeed with valid signatures.
   - Invalid signature returns 400 with `Invalid Stripe signature`.
3. Monitor DB connections and request latencies post-deploy.
4. Roll out to production.

## Rollback Plan

- Revert the commit(s) that introduced the change.
- Reinstall dependencies from the previous lockfile.
- Remove `STRIPE_API_VERSION` from runtime env if rolling back the Stripe config change.

## Acceptance Criteria

- Linting passes under ESLint v9 flat config.
- All Prio 1 endpoints have rate limiting.
- Stripe webhook rejects missing/invalid signatures with 400.
- JSON payloads above 1MB are rejected with 413.
- Prisma uses pooling params in production.
- Documentation updated and consistent with runtime behavior.
