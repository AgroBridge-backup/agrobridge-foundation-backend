# AgroBridge Foundation Backend — Engineering Guide

> **Status:** Fact-checked IC-level architecture reference. Written by reading every
> source file in `src/`, the Prisma schema, the deployment config, and the CI workflows.
> Every claim below is sourced to a `file:line` so future agents can verify, not trust.
>
> **Audience:** Staff/staff+ engineers and autonomous agents onboarding to the backend.
> **Scope:** The API server in this repo (`agrobridge-foundation-backend`). The
> frontend lives in a sibling repo (`agrobridge-foundation-web`).
>
> **Last verified:** against commit `905678c` (Feb 18 2026).

---

## 0. TL;DR

Fastify 5 + TypeScript + Prisma 7 (PostgreSQL) + Redis + Stripe API for a nonprofit.
It serves donations (one-time & recurring via Stripe Checkout), contact forms,
campaign management, an admin dashboard, and admin auth (JWT in signed cookies).
It is observability-heavy (OpenTelemetry, Prometheus, structured error taxonomy)
and security-heavy (tiered rate limiting, abuse detection, XSS sanitization,
timing-attack-hardened login).

**Before you change anything, read §9 "Critical Issues & Landmines"** — there are
several confirmed production-impacting bugs (migration strategy, JWT rotation,
error misclassification) that will bite you if you treat this codebase as trustworthy
at face value.

---

## 1. Repository Facts

| Property | Value | Source |
|---|---|---|
| Runtime | Node.js >= 20.0.0 | `package.json:6-8` |
| Module system | **ESM** (`"type": "module"`) | `package.json:5` |
| Framework | Fastify 5.7 | `package.json:64` |
| Language | TypeScript 5.5, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `tsconfig.json:8-14` |
| DB | PostgreSQL via Prisma 7.2 + `@prisma/adapter-pg` (driver adapter) | `package.json:56-57`, `src/db/prisma.ts:8` |
| Cache | Redis 4.7 (node-redis) | `package.json:69`, `src/cache/redis-client.ts:1` |
| Payments | Stripe 20.2 | `package.json:70` |
| Validation | Zod 4.3 | `package.json:71` |
| Build output | `dist/` (mirrors root; entry is `dist/src/server.js`) | `tsconfig.json:6-7`, confirmed `dist/src/server.js` exists |
| Test matrix | Vitest (unit/integration/contract/chaos), Playwright (e2e), k6 (load), tinybench | `package.json:28-36` |
| Deployment target | Render (Docker, free tier) | `render.yaml:13`, `Dockerfile` |

> **⚠️ Path discrepancy:** the frontend's `CLAUDE.md` claims the backend lives at
> `/Users/mac/Documents/agrobridge-foundation-backend/`. The actual path on this
> machine is `/Users/alex/Documents/agrobridge-foundation-backend/`. Treat the
> frontend doc's path as stale.

---

## 2. Bootstrap & Process Lifecycle

Entry: `src/server.ts` → `src/app.ts` (`buildApp()`).

### 2.1 Startup sequence (`src/server.ts`)
1. `import 'dotenv/config'` — loads `.env`.
2. `await startOtel()` — OpenTelemetry SDK **starts before** the app is built (`src/observability/otel.ts:15`). Auto-instrumentations enabled; OTLP exporter only if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `OTEL_DIAG=1` enables diag logging.
3. `buildApp()` — constructs the Fastify instance (see §2.2).
4. `app.listen({ port, host: '0.0.0.0' })`.

### 2.2 Graceful shutdown (`src/server.ts:22-59`)
- Hooks `SIGTERM`, `SIGINT`.
- 15s (`SHUTDOWN_TIMEOUT_MS`) force-exit safety net via `setTimeout().unref()` — guarantees termination even if `app.close()` hangs.
- `app.close()` drains in-flight requests then runs `onClose` hooks (Prisma `$disconnect`, Redis `quit`, login-limiter destroy).
- `unhandledRejection` → logged (process continues); `uncaughtException` → **fatal exit 1**. This is the correct asymmetry.

### 2.3 App factory (`src/app.ts`)
Decorators attached to the Fastify instance (available as `app.env`, `app.prisma`, `app.stripe` everywhere):
- `app.env` — Zod-validated env (`loadEnv()`).
- `app.prisma` — `PrismaClient` via `PrismaPg` driver adapter; `onClose` → `$disconnect()`.
- `app.stripe` — `new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION })`.

**Request lifecycle hooks (in registration order):**
1. `onRequest` (`app.ts:176`): correlates logs with the active OTel span (`traceId` child logger), seeds `requestContext` (so deeper layers get a request-scoped logger), then invokes `rateLimitMiddleware` (the custom tiered limiter).
2. `onResponse` (`app.ts:196`): records HTTP response status code + error status on the span.
3. `onSend` (`app.ts:210`): injects `X-API-Version: 2026-02-17` and echoes `X-Request-Id` for end-to-end correlation; tags the span with the client's `Accept-Version` if present.
4. `setErrorHandler` (`app.ts:227`): routes everything through `handleErrorWithObservability` for classification + metrics, then formats Zod / `AppError` / Fastify-AJV / generic errors into the `{ ok, error }` envelope.

**Other registered plugins (order matters):** `helmet` (CSP + HSTS preload) → `cors` (allowlist callback) → `@fastify/rate-limit` (global 200/min) → `cookie` (signed) → `jwt` (cookie `ab_admin`) → `rawBody` (Stripe webhook verification) → `swagger` + `swagger-ui` (`/docs`).

> **Custom JSON parser:** `app.ts:41-54` installs a 1 MiB (`1_048_576`) `application/json` parser that trims whitespace and treats empty body as `undefined`. Anything over 1 MiB is rejected.

### 2.4 Request identity & correlation
- Request ID comes from `x-request-id` header or a generated `crypto.randomUUID()` (`app.ts:36`).
- Every response carries `X-Request-Id` + `X-API-Version`.
- `requestContext` (`src/observability/request-context.ts`) is an `AsyncLocalStorage`-style carrier so services/repositories can log with the request's logger without threading it through every call.

---

## 3. Configuration (`src/config/env.ts`)

Environment is validated **once at boot** with Zod. Invalid env → process refuses to start (fail-fast). This is the contract; do not read `process.env` directly elsewhere (a few places still do — see §9).

**Required (no defaults):**
| Var | Constraint |
|---|---|
| `DATABASE_URL` | non-empty |
| `JWT_SECRET` | `>= 32` chars |
| `COOKIE_SECRET` | `>= 16` chars |
| `STRIPE_SECRET_KEY` | non-empty |
| `STRIPE_WEBHOOK_SECRET` | non-empty |
| `STRIPE_API_VERSION` | non-empty (e.g. `2024-12-18.acacia`) |
| `CORS_ORIGIN` | any string (comma-separated list of origins) |

**Optional with defaults:**
| Var | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development\|test\|production` |
| `PORT` | `3000` | |
| `REDIS_URL` | `redis://localhost:6379` | |
| `DB_POOL_MAX` | `20` | Postgres pool max (driver adapter) |
| `DB_POOL_IDLE_TIMEOUT` | `20000` (ms) | |
| `JWT_SECRET_PREVIOUS` | — | ⚠️ **rotation code is broken — see §9.2** |
| `DONATION_REDIRECT_ORIGINS` | — | Falls back to `CORS_ORIGIN` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP collector URL |
| `DB_SLOW_MS` | — | Slow-query log threshold |
| `METRICS_AUTH_TOKEN` | — | `>= 16` chars; **required in prod** to scrape `/metrics` via bearer |

Feature-flag vars (`FF_DONATIONS_*`, `FF_CONTACT_FORM_ENABLED`, `FF_MAINTENANCE_*`) are read **directly from `process.env`** in `src/api/routes/feature-flags.ts:70`, **not** through `loadEnv()`. Adding a new flag does not require touching `env.ts`.

Logging: Pino, level `info` in prod / `debug` elsewhere, with redaction of `authorization`, `cookie`, `set-cookie`, `password`, `*.password`, `*.passwordHash` (`src/config/logger.ts`).

---

## 4. API Surface

All routes are registered in `src/api/routes/index.ts`. Everything except `/metrics` is prefixed `/api`. The canonical envelope (`src/http/response.ts`) is:

```ts
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code; message; details? } };
```

### 4.1 Public routes (no auth)

| Method | Path | Tier | Source | Notes |
|---|---|---|---|---|
| GET | `/api/health` | PUBLIC | `health.ts:9` | Liveness + shallow readiness (`SELECT 1`). 503 if DB down. |
| GET | `/api/health/deep` | PUBLIC (but `requireAdmin`) | `health.ts:28` | Adds uptime; **JWT-gated** despite the tier. |
| GET | `/api/health/rate-limit[/deep]` | — | `health.ts:52` | Rate-limiter store health; wired by `rate-limiting/health-check.ts`. |
| POST | `/api/contacts` | CONTACT (5/min) | `contacts.ts:8` | Honeypot + timing + DOMPurify sanitization. |
| POST | `/api/donations/intent` | FINANCIAL (10/min) | `donations.ts:14` | Creates `PENDING` donation + Stripe Checkout session. Optional idempotency. |
| GET | `/api/campaigns` | PUBLIC | `campaigns.ts:32` | Active campaigns + progress. |
| GET | `/api/campaigns/:slug` | PUBLIC | `campaigns.ts:41` | Slug validated `^[a-z0-9-]+$`. |
| GET | `/api/campaigns/:slug/progress` | PUBLIC | `campaigns.ts:69` | Raised/goal/donor counts. |
| GET | `/api/feature-flags` | PUBLIC | `feature-flags.ts:68` | `Cache-Control: public, max-age=60, s-maxage=60`. |
| GET | `/metrics` | — | `metrics.ts:14` | Prometheus format; **auth-gated** (see §7.4). |

### 4.2 Auth routes (`src/api/routes/auth.ts`)
| Method | Path | Tier | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | STRICT (20/min) | Email lookup → bcrypt (constant-time, dummy-hash + jitter) → per-IP+account lockout. Sets signed `ab_admin` cookie, 24h expiry. |
| POST | `/api/auth/logout` | PUBLIC | Clears `ab_admin`. |
| POST | `/api/auth/refresh` | ADMIN (100/min) | Verifies current token **and** that the user is still active/not locked in DB, then re-issues. |

### 4.3 Admin routes — JWT required (`requireAdmin` → `requireSuperAdmin` for mutations)

Admin donations/dashboard (`admin.ts`), admin contacts (`admin-contacts.ts`), admin users (`admin-users.ts`), admin campaigns (inside `campaigns.ts`).

| Group | Endpoints | Role |
|---|---|---|
| Donations | `GET /api/admin/donations` (offset **or** cursor pagination), `GET /api/admin/dashboard` (15s TTL cache) | `ADMIN` |
| Contacts | `GET/PATCH /api/admin/contacts[/:id]`, `DELETE`, `GET /export` (CSV/JSON) | read `ADMIN`, mutate `SUPER_ADMIN` |
| Users | full CRUD + `/me` + `/reset-password` + `/restore` | mutate `SUPER_ADMIN`, `/me` self-service |
| Campaigns | `GET/POST /api/admin/campaigns`, `GET/PATCH/DELETE /:id`, `POST /:id/restore` | `SUPER_ADMIN` |

### 4.4 Webhook
| Method | Path | Tier | Notes |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | WEBHOOK (500/min, fail-open) | `rawBody: true`; signature verified; 5-min replay window; idempotent via `WebhookEvent` table; status update + event-mark-processed in one transaction. |

**Full route count:** 31 (matches `AGENTS.md:94`).

---

## 5. Data Model (`prisma/schema.prisma`)

PostgreSQL. 5 models. Money is **always minor units (cents)**. **Soft delete** (`deletedAt`) on `Campaign`, `Donation`, `ContactRequest`, `AdminUser`; repositories filter `deletedAt: null` by default. UUID PKs. Indexes are well-chosen (composite `(status, createdAt)`, `(campaignId, status)`, `(donorEmail, createdAt)`, soft-delete indexes).

```
Campaign 1 ──< N Donation (optional campaignId)
AdminUser          WebhookEvent (id = Stripe event.id, idempotency key)
ContactRequest
```

Enums: `DonationStatus{PENDING,SUCCEEDED,EXPIRED,REFUNDED}`, `DonationType{ONE_TIME,RECURRING}`,
`ContactRequestStatus{NEW,IN_REVIEW,RESOLVED,SPAM}`, `AdminRole{ADMIN,SUPER_ADMIN}`,
`CampaignStatus{DRAFT,ACTIVE,PAUSED,COMPLETED,CANCELLED}`.

Notable fields:
- `Donation.stripeSessionId @unique` — checkout session; the join key for webhook updates.
- `Donation.stripeSubscriptionId` — exists but **never populated** by current code (see §9.4).
- `AdminUser.failedAttempts`, `lockedUntil`, `lastLoginIp` — lockout + audit.
- `WebhookEvent.processed` + `rawPayload` — idempotency + forensic log.

### 5.1 ⚠️ Migration strategy is broken (read §9.1)
`prisma/migrations/` is **gitignored** (`.gitignore:10`) and absent, yet `render-start.sh:12`
runs `prisma migrate deploy`. There is no versioned migration history in the repo.

---

## 6. Cross-Cutting Systems

### 6.1 Rate limiting (two independent layers — important)
There are **two** rate limiters and both run in production:

1. **`@fastify/rate-limit`** (`app.ts:104`): global, `max: 200 / 1 min`, **disabled in `test`**. **No Redis store is configured**, so it is in-memory/per-instance only — it does **not** coordinate across horizontally-scaled instances.
2. **Custom tiered limiter** (`src/rate-limiting/`): runs in the `onRequest` hook (`app.ts:192` → `rateLimitMiddleware`). Per-route tiers from `tier-config.ts`:

   | Tier | Limit | Example route |
   |---|---|---|
   | FINANCIAL | 10/min | `/api/donations/intent` |
   | CONTACT | 5/min | `/api/contacts` |
   | STRICT | 20/min | `/api/auth/login` |
   | ADMIN | 100/min | `/api/admin/*`, `/api/auth/refresh` |
   | PUBLIC | 300/min | health, campaigns, feature-flags |
   | WEBHOOK | 500/min (fail-open) | stripe webhook |
   | ABUSE / DDOS / VIP_ADMIN / API_KEY | defined, available for opt-in | — |

   Identifier is `ip:route`. Backed by `RedisRateLimitStore` with `InMemoryRateLimitStore` fallback (`tiered-rate-limiter.ts:37-47`). `skipOnError` per-tier controls fail-open vs fail-closed. Emits `X-RateLimit-*` + `Retry-After` headers, and Prometheus metrics (`rateLimitChecksTotal`, `rateLimitLatency`, `rateLimitFallbacksTotal`, `rateLimitErrorsTotal`).

> **Effective limit per route = the stricter of the two.** For donations that's 10/min (tiered), gated behind a 200/min global cap. The global cap is largely subsumed by the tiered system but acts as a coarse per-instance DoS guard. When reasoning about limits, **always reason about the tiered limiter**; treat the global one as belt-and-suspenders.

### 6.2 Abuse detection
`src/rate-limiting/abuse-detection.ts`. _(The prior `src/ml/abuse-detector.ts` and `src/security/*` subsystems were dead code and were removed in PR #14.)_
Runs **before** the tiered limiter inside `rateLimitMiddleware` (`middleware.ts:14`). If `abuseScore.isAbusive`, the request is short-circuited with a 429 (`tier: ABUSE`) and an OTel span. Has its own cleanup loop (started/stopped in `auth.ts:55-63`).

### 6.3 Auth security (`src/services/auth-service.ts`)
Login is hardened against user enumeration:
- **Constant-time path:** always bcrypt-compares against either the real hash or a `DUMMY_PASSWORD_HASH` when the user doesn't exist (`auth-service.ts:66-71`).
- **Jitter:** 10–30 ms random delay plus a 60 ms minimum processing floor (`addJitter`).
- **bcrypt cost 12** everywhere (login, create, change, reset, seed).
- **TOCTOU-safe rate limiting** via atomic `LoginRateLimiter.checkAndRecord(ip, isFailure)` (`auth.ts:87,130`). Config: 5 attempts / 15 min / 15-min lockout.
- **Account lockout** also recorded in DB (`AdminUser.lockedUntil`).

JWT: `@fastify/jwt`, signed cookie `ab_admin` (`httpOnly`, `secure` in prod, `sameSite: 'lax'`, 24h). `requireAdmin`/`requireSuperAdmin` in `src/auth/jwt.ts` attach `req.admin = { adminUserId, email, role }`.

### 6.4 Idempotency (`src/services/idempotency-service.ts`)
For money endpoints. Client sends `Idempotency-Key: <uuid v4>`. Redis key `idempotency:<key>`:
- `SET NX EX 60` → "processing" lock; on success, execute handler then cache result for **24h** (`IDEMPOTENCY_TTL_SEC`).
- Duplicate key while processing → **409 `IDEMPOTENCY_CONFLICT`**.
- Duplicate after completion → returns cached body.
- **Fail-open:** if Redis is unavailable, executes the handler directly with no protection (`idempotency-service.ts:66-70`). For a financial endpoint this means duplicate Stripe sessions are possible during a Redis outage — review this tradeoff before scaling.

### 6.5 Stripe integration
- `POST /api/donations/intent` flow (`donations.ts` → `DonationService` → `StripeService`):
  1. Validate + create `PENDING` `Donation` row.
  2. Resolve `successUrl`/`cancelUrl` through `validateRedirectUrl` (open-redirect defense, see §6.6).
  3. Create Stripe Checkout session (`payment` or `subscription` mode for monthly). Metadata carries `donationId`.
  4. `attachStripeSession` writes `stripeSessionId` back onto the donation.
- **Webhook** (`webhooks-stripe.ts` + `stripe-webhook-handler.ts`): verifies signature on the **raw body**, enforces a **5-min replay window** (`MAX_EVENT_AGE_MS`), persists the event idempotently, then runs `transactionalStatusUpdate` — **atomic** `Donation.updateMany(status)` + `WebhookEvent.update(processed=true)` in one `$transaction`.

> **⚠️ Functional gap — see §9.4:** only `checkout.session.completed`/`expired` are handled. Monthly renewals (`invoice.paid`) are not, and `stripeSubscriptionId` is never stored.

### 6.6 Open-redirect defense (`src/utils/redirect-url.ts`)
`validateRedirectUrl` rejects URLs that: contain credentials, have a non-allowlisted origin, aren't HTTPS in prod, aren't HTTP(S) in dev, or whose path isn't in `allowedPathPrefixes` (e.g. `/donation/success`, `/donation/cancel`). On rejection it **falls back to the default URL and logs a warning** rather than erroring — this is deliberate (donations shouldn't fail on a bad client URL). Allowlist comes from `DONATION_REDIRECT_ORIGINS` or falls back to `CORS_ORIGIN`; localhost dev origins are merged in non-prod.

### 6.7 XSS / contact-form hardening (`src/lib/xss-sanitizer.ts`, `contact-service.ts`)
- DOMPurify (server-side via JSDOM) with an empty `ALLOWED_TAGS` config → all HTML stripped.
- Honeypot fields (`website`, `_gotcha`) + timing gate (3 s–30 min). Triggered → **fake 201 success** to not tip off bots (`contact-service.ts:75-83`).
- Pre-sanitization XSS pattern detection logged to spans (and `console.warn` for SIEM). Email SHA-256 (truncated) used in logs to avoid PII leakage.
- Admin contact routes set a **locked-down CSP** + security headers (`admin-contacts.ts:55-79`) since they render UGC.

### 6.8 Error observability (`src/middleware/error-observability.ts`)
Every error flows through `handleErrorWithObservability`: it classifies by source (Prisma, Stripe, Zod, `AppError`, Fastify, infrastructure-message-pattern, else "code bug"), records Prometheus metrics, tags the OTel span, and emits a structured Pino log. Outputs a `ClassifiedError` the handler maps to HTTP status + taxonomy code.

> **⚠️ Bug — see §9.3:** the Prisma classifier has duplicate `P2025` branches; "record not found" is misclassified as 503 pool-exhausted, and the correct 404 branch is dead code.

### 6.9 Database access layer
Repositories wrap Prisma and tag every query with an OTel DB span (`withDbSpan`): `donation-repo`, `campaign-repo`, `contact-request-repo`, `admin-user-repo`, `webhook-event-repo`. Cursor pagination helper in `src/utils/cursor.ts`; keyset filter on `(createdAt, id)` in `donation-repo.ts:147-196`. Dashboard metrics use a raw `COUNT(DISTINCT "donorEmail")` (`donation-repo.ts:220-224`).

---

## 7. Operations

### 7.1 Local dev
```bash
cp .env.example .env           # fill STRIPE_*, JWT_SECRET (>=32), COOKIE_SECRET (>=16)
docker-compose up -d           # Postgres + Redis (see docker-compose.yml)
npx prisma generate
npx prisma migrate dev         # NOTE: creates a local migrations dir that is gitignored
npm run dev                    # tsx watch src/server.ts → http://localhost:3000
npx prisma db seed             # uses prisma/seed.ts (ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_ROLE)
```
API docs at `http://localhost:3000/docs` (Swagger UI).

### 7.2 Testing tiers (from `package.json`)
- **Tier 1:** `npm run test:tier1` = `lint` + `test:unit`. Unit tests build first.
- **Tier 2:** `npm run test:integration` — requires Docker (Testcontainers spins Postgres). Serial, `--no-file-parallelism`, 180 s timeouts.
- **Tier 3:** chaos + benchmarks (`tinybench`) + k6 load (spike/soak). `TEST_TIER3=1` gate.
- **Contracts:** `npm run contracts:check` = repo-hygiene + OpenAPI drift check + contract tests.
- 52 `*.test.ts` files across `tests/{unit,integration,e2e,contracts,chaos,performance,security,benchmarks,load}`.

Run a single file: `npx vitest run tests/unit/<file>`.

### 7.3 Contract-driven versioning (`contracts/`)
- Locked response schemas: `contracts/schemas/post-api-{donations-intent,contacts}.response.v1.{ts,json}`.
- OpenAPI snapshot: `contracts/openapi/openapi.v1.snapshot.json`.
- Policy: `contracts/COMPATIBILITY_POLICY.md` — additive-only within a version; bump to `*.v2` for breaking changes. CI enforces via `contracts:openapi:check` + `test:contracts`.
- Workflow: change schema → `contracts:openapi:export` → `contracts:check` → commit artifacts together.

### 7.4 Metrics & `/metrics` auth (`metrics.ts`)
Three auth paths, evaluated in order: (1) `Authorization: Bearer <METRICS_AUTH_TOKEN>` (for Prometheus); (2) valid admin JWT cookie (for dashboards); (3) **non-production only**, unauthenticated if `METRICS_AUTH_TOKEN` is unset. In prod with no token configured, `/metrics` returns 401. **Set `METRICS_AUTH_TOKEN` in prod.**

### 7.5 Deployment (Render)
- `render.yaml`: web service (Docker, **free** plan, Oregon), Postgres 16 (free), `healthCheckPath: /api/health`.
- `Dockerfile`: multi-stage, `node:20-slim`, installs OpenSSL for Prisma, **non-root** `appuser`, `EXPOSE 10000`, `NODE_ENV=production`.
- `render-start.sh`: runs `npx prisma migrate deploy` then `exec node dist/src/server.js`.
- ⚠️ `render.yaml` references `STRIPE_PUBLISHABLE_KEY` and `SENTRY_DSN`. **Sentry is not installed** (no `@sentry/*` in `package.json`; `docs/SENTRY-SETUP.md` is aspirational). `STRIPE_PUBLISHABLE_KEY` is a frontend var. Both are dead config on the backend.
- CI/CD: `.github/workflows/` — `backend-deploy.yml`, `backend-gates.yml`, `canary-deploy.yml`, `contract-release.yml`, `preprod-release-gate.yml`, `synthetic-monitoring.yml`, `rollback.yml`, `weekly-reliability-scorecard.yml`. Deploy gates are tier-1/2/3 + contract + release-report driven.

---

## 8. Mental Model: Request Flow (donations)

```
Client ── POST /api/donations/intent ─────────────────────────────▶ Fastify
 │                                                                 │
 │  onRequest hook:                                                │
 │   1. OTel span + traceId child logger                          │
 │   2. requestContext.run(logger)                                │
 │   3. rateLimitMiddleware:                                       │
 │        abuseDetector.detectAbuse → 429 if abusive              │
 │        tieredLimiter.checkRequest (FINANCIAL 10/min, Redis)    │
 │  @fastify/rate-limit (global 200/min, in-memory)               │
 │                                                                 ▼
 │  handler (donations.ts):                                        │
 │   if Idempotency-Key (uuid v4):                                 │
 │     IdempotencyService.execute → Redis SET NX; 409 if in-flight │
 │   DonationService.createDonationIntent                          │
 │     └─ Zod intentSchema → createPending (PENDING row)           │
 │   validateRedirectUrl(successUrl/cancelUrl)  ← open-redirect    │
 │   StripeService.createCheckoutSession                           │
 │     └─ stripe.checkout.sessions.create → attachStripeSession    │
 │                                                                 ▼
Client ◀── { ok:true, data:{ sessionId, url } } + X-Request-Id ────
```

Webhook later: `Stripe → POST /api/webhooks/stripe → constructEvent (sig) → replay check → WebhookEvent.createIfNotExists → transactionalStatusUpdate`.

---

## 9. Critical Issues & Landmines (fact-checked)

These are confirmed by reading source + build artifacts + git state. Severity is operational impact, not style.

### 🟠 9.1 P0 — Production DB schema will not be applied on fresh deploys *(remediated on `fix/p0-prisma-migrations-baseline`)*
- `prisma/migrations/` was **gitignored** (`.gitignore:10`) and absent; `render-start.sh:12` ran `prisma migrate deploy` with **no migration files to apply**. The integration suite also bypassed migrations via `prisma db push` (`tests/integration/test-db.ts:27`), so the prod path was never tested.
- **Impact (pre-fix):** a brand-new Render Postgres instance had **zero tables**; every query failed with "relation does not exist". Operations survived on a manual `prisma db push`.
- **Remediation on this branch:**
  1. Baseline migration committed at `prisma/migrations/20260220000000_init/migration.sql` + `migration_lock.toml` (synthesized via `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`).
  2. Un-gitignored `prisma/migrations` (`.gitignore`).
  3. Added a Testcontainers gate test (`tests/integration/migrations/migration-deploy.int.test.ts`) that proves `migrate deploy` creates all 5 tables, records the baseline in `_prisma_migrations`, and is idempotent.
- **Operator runbook — first deploy to the EXISTING prod DB (one-time):** the prod DB has tables but no `_prisma_migrations` history. Before the first `migrate deploy`, run once so Prisma doesn't try to re-create existing tables:
  ```bash
  npx prisma migrate resolve --applied 20260220000000_init
  ```
  Fresh environments (new DBs) do **not** need this — `migrate deploy` applies the baseline normally.
- **Regenerating the baseline after a schema change:** `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` (Prisma 7 flag; the old `--to-schema-datamodel` was removed).
- **Follow-up (not in this PR):** `render-start.sh` shells out to `npx prisma`, but `prisma` is a **devDependency** and the prod image is built with `--omit=dev` — so runtime relies on `npx` fetching the CLI at startup (slow/fragile, needs network). Consider moving `migrate deploy` to the Docker build stage or adding `prisma` to `dependencies`.

### 🔴 9.2 P1 — JWT secret rotation crashes the process
- `app.ts:127-138` wraps `app.jwt.verify` to fall back to `JWT_SECRET_PREVIOUS`. On failure it calls `const jwtModule = require('jsonwebtoken')`.
- This repo is **ESM** (`"type": "module"`): `require` is **not defined** → `ReferenceError`. Also `jsonwebtoken` is **not a dependency** (grep = 0 hits in `package.json`; absent from `node_modules`).
- **Trigger:** `JWT_SECRET_PREVIOUS` set + any request presenting a token signed with the old secret.
- **Impact:** every such request returns 500; the "zero-downtime rotation" feature is a footgun.
- **Fix:** `import jwt from 'jsonwebtoken'` at top of file and add it to `dependencies`, or use `createRequire(import.meta.url)`, or drop the feature until properly built + tested.

### 🟠 9.3 P2 — Prisma "not found" errors misclassified as DB pool exhaustion
- `error-observability.ts:194` `if (code === 'P2025')` returns `INFRA_DB_POOL_EXHAUSTED` / **503**.
- **P2025 is "record not found"**, not pool exhaustion. (P2024 = timeout; there is no Prisma code for "pool exhausted" in the P2xxx range as commonly assumed.)
- The correct `CLIENT_NOT_FOUND` / **404** branch at `error-observability.ts:205` is **dead code** (unreachable because the first `P2025` check returns).
- **Impact:** legitimate 404s surfacing as Prisma P2025 are reported (and alerted) as infrastructure 503s — noisy pages + wrong HTTP semantics.
- **Fix:** delete the first `if (code === 'P2025')` block; keep the 404 one; re-examine P2024 too.

### 🟠 9.4 P2 — Recurring donations after month 1 are invisible
- `stripe-webhook-handler.ts:59-62` handles only `checkout.session.completed` / `checkout.session.expired`.
- Monthly renewals fire `invoice.paid` / `invoice.payment_succeeded` (not handled) → no new `Donation` row, no status change.
- `Donation.stripeSubscriptionId` exists in the schema but **no code path writes it** (`transactionalStatusUpdate` only flips status).
- **Impact:** dashboard `totalRaised`/`donorCount` undercount recurring revenue; no audit trail for renewals, refunds (the `REFUNDED` enum value has no writer either), or disputes.
- **Fix:** handle `invoice.paid` (and ideally `charge.refunded`), persist `stripeSubscriptionId` on checkout completion, and decide whether renewals create new rows or update existing ones.

### 🟡 9.4 P3 — `swagger-ui` (`/docs`) is exposed in production
- `app.ts:146-174` registers Swagger UI with no `NODE_ENV` guard. Prod visitors can enumerate the entire API surface.
- **Fix:** gate registration (or the route) behind `NODE_ENV !== 'production'`, or put `/docs` behind admin auth.

### 🟡 9.5 P3 — Idempotency fail-open on a money endpoint
- `idempotency-service.ts:66-70` executes the handler directly if Redis is down. Intentional, but for a financial path a Redis outage means duplicate Stripe Checkout sessions can be created.
- **Fix to consider:** fail-closed (reject the request) when Redis is unavailable, or rely on Stripe's own `Idempotency-Key` header as a second layer.

### 🟡 9.6 P3 — Error `latencyMs` is always ~0
- `error-observability.ts:462` sets `startTime` at function entry, then `latencyMs: Date.now() - startTime` a few lines later. The metric is meaningless. Capture request start from Fastify instead.

### 🟡 9.7 P3 — Global rate limiter is per-instance only
- `@fastify/rate-limit` (`app.ts:104`) has no `redisStore`, so the 200/min global cap is in-memory and not shared across instances. On Render free (single instance) this is fine; it will silently weaken if the service scales out. The custom tiered limiter **is** Redis-backed, so route-level limits survive — only the global cap is affected.

### 🟢 9.8 Documentation hygiene
- Frontend `CLAUDE.md` path to this repo is wrong (`/Users/mac/...` vs `/Users/alex/...`).
- `AGENTS.md:94` says "31 total" routes — accurate. `AGENTS.md:156` admits "Some unit tests are failing".
- `docs/SENTRY-SETUP.md` documents Sentry, but Sentry is not installed.
- `render.yaml` carries `SENTRY_DSN` / `STRIPE_PUBLISHABLE_KEY` (dead on backend).

---

## 10. Strengths (don't regress these)

- **Fail-fast config** via Zod at boot.
- **Graceful shutdown** with a force-exit safety net + correct unhandled/uncaught asymmetry.
- **Constant-time login** (dummy hash + jitter + atomic lockout) — genuinely good.
- **Transactional webhook finalization** + **5-min replay window** + idempotent event store.
- **Open-redirect allowlisting** with per-path prefix enforcement.
- **DOMPurify + honeypot + timing** on contact form; locked CSP on admin UGC views.
- **Tiered rate limiting** with Redis + in-memory fallback + per-tier fail-open/fail-closed + Prometheus metrics.
- **Soft deletes + deliberate indexing**; money in minor units throughout.
- **Contract-locked schemas** with OpenAPI snapshot + CI drift enforcement.
- **Non-root Docker**, secret redaction in logs, `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` in `tsconfig`.

---

## 11. Where to look first (by task)

| If you're... | Start here |
|---|---|
| Adding a public/admin route | `src/api/routes/`, mirror an existing file; register in `index.ts`; add the tier in `tier-config.ts:81`. |
| Changing a response shape | `contracts/schemas/` + `contracts:openapi:export` + `contracts:check`. |
| Touching money | `services/donation-service.ts`, `services/stripe-service.ts`, `webhooks/stripe-webhook-handler.ts`, `services/idempotency-service.ts`. |
| Auth changes | `services/auth-service.ts`, `api/routes/auth.ts`, `auth/jwt.ts`. Mind §9.2. |
| DB schema change | `prisma/schema.prisma` → `prisma migrate dev` → **commit the migration** (see §9.1) → update repos in `src/repositories/`. |
| Rate-limit tuning | `src/rate-limiting/tier-config.ts`; verify both layers (§6.1). |
| Observability | `src/observability/` (otel, error-metrics, request-context, db-span), `src/middleware/error-observability.ts`. |
| Deploy | `render.yaml`, `Dockerfile`, `render-start.sh`; mind §9.1 + §9.2 before rotating secrets or provisioning a new DB. |

---

*Authored as a fact-checked reference. Verify the `file:line` citations against the
current commit before relying on them — this codebase is under active remediation
(see `FAANG_REMEDIATION_PLAN.md`, `REMEDIATION_TRACKER.md`).*
