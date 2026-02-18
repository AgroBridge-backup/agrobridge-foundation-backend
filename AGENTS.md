# CLAUDE.md

## Project Overview

Backend API for AgroBridge Foundation (agrobridgefoundation.org) — a nonprofit supporting small agricultural producers. Handles donations (Stripe), contact forms, admin dashboard, campaign management, and webhook processing. Part of the AgroBridge ecosystem.

- **Frontend repo**: `~/Documents/agrobridge-foundation-web` (static HTML/CSS/JS served by Express)
- **This repo**: Canonical backend API server

## Tech Stack

- **Runtime**: Node.js >= 20.0.0
- **Framework**: Fastify 5.7
- **Language**: TypeScript 5.5
- **Database**: PostgreSQL via Prisma 7.2 with `@prisma/adapter-pg`
- **Cache**: Redis 4.7 via `@redis/client`
- **Payments**: Stripe 20.2
- **Auth**: JWT (`@fastify/jwt` 10) + signed cookies (`@fastify/cookie` 11)
- **Observability**: OpenTelemetry SDK, Pino logger (via Fastify built-in)
- **Validation**: Zod 4.3
- **API Docs**: Swagger UI at `/docs` (`@fastify/swagger` + `@fastify/swagger-ui`), Prometheus metrics at `/metrics`
- **Testing**: Vitest 4.0, Playwright (E2E), k6 (load tests), Testcontainers
- **Linting**: ESLint 9, Prettier 3

## Commands

```bash
npm run dev                # Dev server with tsx watch
npm run build              # Compile TypeScript (tsc)
npm run start              # Run compiled dist/server.js
npm run prisma:generate    # Generate Prisma client
npm run prisma:migrate     # Run database migrations (dev)
npm run prisma:seed        # Seed database
npm run test               # Run all tests (vitest)
npm run test:watch         # Tests in watch mode
npm run test:unit          # Unit tests only (builds first)
npm run test:integration   # Integration tests (requires Docker)
npm run test:e2e           # E2E tests (Playwright)
npm run test:load          # Load tests (requires k6)
npm run test:coverage      # Coverage report (requires Docker)
npm run lint               # ESLint (zero warnings)
npm run format             # Prettier formatting
```

## Directory Structure

```
src/
├── api/
│   ├── routes/            # Fastify route definitions (10 files)
│   │   ├── admin.ts       # GET /api/admin/donations, /api/admin/dashboard
│   │   ├── admin-users.ts # CRUD for admin users (10 endpoints)
│   │   ├── auth.ts        # POST login/logout, GET refresh
│   │   ├── campaigns.ts   # Public (3) + admin (6) campaign endpoints
│   │   ├── contacts.ts    # POST /api/contacts
│   │   ├── donations.ts   # POST /api/donations/intent
│   │   ├── health.ts      # GET /api/health
│   │   ├── metrics.ts     # GET /metrics (Prometheus)
│   │   ├── webhooks-stripe.ts  # POST /api/webhooks/stripe
│   │   └── index.ts       # Route registration
│   └── schemas/           # Zod/OpenAPI schemas
├── auth/                  # JWT authentication logic
├── cache/                 # Redis caching layer
├── config/
│   └── env.ts             # Zod-validated environment schema
├── db/
│   └── prisma.ts          # PrismaPg adapter connection
├── errors/                # Custom error classes
├── http/                  # HTTP response helpers
├── ml/                    # Abuse detection (ML-based)
├── observability/         # OpenTelemetry, Pino logger, metrics
├── rate-limiting/         # Tiered rate limiting with Redis
├── repositories/          # Database access layer (5 repos)
├── services/              # Business logic (8 services)
├── types/                 # TypeScript type definitions
├── utils/                 # Cursor pagination, etc.
├── webhooks/              # Webhook handlers
├── app.ts                 # Fastify app factory (CORS, helmet, rate limiting, CSRF)
└── server.ts              # Entry point

prisma/
├── schema.prisma          # 5 models: Campaign, Donation, ContactRequest, WebhookEvent, AdminUser
└── seed.ts                # Database seeder

tests/
├── unit/                  # Unit tests
├── integration/           # Integration tests
├── e2e/                   # E2E tests (Playwright)
├── helpers/               # Test utilities
├── mocks/                 # Mock factories
└── fixtures/              # Test data
```

## API Routes (31 total)

| Group       | Count | Key Endpoints                                                        |
| ----------- | ----- | -------------------------------------------------------------------- |
| Auth        | 3     | POST /api/auth/login, /api/auth/logout, GET /api/auth/refresh        |
| Health      | 3     | GET /api/health, /api/health/rate-limit, /api/health/rate-limit/deep |
| Metrics     | 1     | GET /metrics (Prometheus exposition format)                          |
| Contacts    | 1     | POST /api/contacts                                                   |
| Donations   | 1     | POST /api/donations/intent                                           |
| Campaigns   | 9     | 3 public (list, get, stats) + 6 admin CRUD                           |
| Admin       | 2     | GET /api/admin/donations, /api/admin/dashboard                       |
| Admin Users | 10    | Full CRUD + /me endpoints                                            |
| Webhooks    | 1     | POST /api/webhooks/stripe                                            |

## Environment Variables

Required (validated by `src/config/env.ts`):

| Variable                | Description                             |
| ----------------------- | --------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string            |
| `JWT_SECRET`            | JWT signing secret (min 32 chars)       |
| `COOKIE_SECRET`         | Cookie signing secret (min 16 chars)    |
| `STRIPE_SECRET_KEY`     | Stripe API secret key                   |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret           |
| `STRIPE_API_VERSION`    | Stripe API version (e.g., `2024-01-01`) |
| `CORS_ORIGIN`           | Allowed CORS origins                    |

Optional:

| Variable                      | Default                  | Description                       |
| ----------------------------- | ------------------------ | --------------------------------- |
| `NODE_ENV`                    | `development`            | Environment                       |
| `PORT`                        | `3000`                   | Server port                       |
| `REDIS_URL`                   | `redis://localhost:6379` | Redis connection                  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —                        | OpenTelemetry collector URL       |
| `DB_SLOW_MS`                  | —                        | Slow query log threshold (ms)     |
| `DB_POOL_MAX`                 | `20`                     | Connection pool maximum size      |
| `DB_POOL_IDLE_TIMEOUT`        | `20000`                  | Connection pool idle timeout (ms) |

## Prisma Models (5)

- **Campaign**: Agricultural project funding campaigns (with soft delete)
- **Donation**: Payment records linked to campaigns (Stripe session tracking)
- **ContactRequest**: Contact form submissions (with admin notes)
- **WebhookEvent**: Stripe event idempotency tracking
- **AdminUser**: Admin authentication (bcrypt passwords, role-based, lockout)

## Key Patterns

### Rate Limiting

Tiered rate limiting with Redis (in-memory fallback). Tiers: PUBLIC (300/min), ADMIN (100/min), WEBHOOK (500/min), STRICT (20/min for login), ABUSE (5/min), VIP_ADMIN, API_KEY, DDOS. Configured in `src/rate-limiting/`.

### Authentication

JWT tokens stored in signed HTTP-only cookies (`ab_admin`). Login → cookie set → subsequent requests auto-authenticated. Account lockout after failed attempts.

### Abuse Detection

ML-based abuse detection in `src/ml/abuse-detector.ts` with configurable cache TTL, risk scoring, and geo-IP analysis.

## Known Issues

- Some unit tests are failing (see `docs/PART1-COMPLETE.md`)
- Connection pooling is configured via `DB_POOL_MAX` (default: 20) and `DB_POOL_IDLE_TIMEOUT` (default: 20000ms) env vars in `db/prisma.ts`

## Development Setup

```bash
git clone <repo-url> && cd agrobridge-foundation-backend
npm install
cp .env.example .env          # Edit with your credentials
docker-compose up -d           # Start PostgreSQL + Redis
npx prisma generate
npx prisma migrate dev
npm run dev                    # http://localhost:3000
```

## Author

Alejandro Navarro Ayala - CEO & Founder, AgroBridge
