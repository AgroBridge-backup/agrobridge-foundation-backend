# Agrobridge Foundation Backend

Backend API for Agrobridge Foundation - donations, contacts, and admin dashboard.

## Features

- **Donation Management**: Stripe Checkout integration, webhooks, status tracking
- **Contact Form**: Secure message submission with validation
- **Admin Dashboard**: Donation metrics, pagination (offset/cursor), filtering
- **Authentication**: JWT-based admin authentication
- **Rate Limiting**: Tiered rate limiting with abuse detection
- **Caching**: Redis-backed caching for metrics and donation lists
- **Monitoring**: Prometheus metrics, Grafana dashboards
- **Observability**: OpenTelemetry tracing, structured logging

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

## API Documentation

Interactive API documentation is available:

- **Swagger UI**: http://localhost:3000/docs

## Authentication

Most admin endpoints require authentication via a signed JWT cookie:

1. POST /api/auth/login with credentials
2. Response sets `ab_admin` cookie
3. Subsequent requests automatically include this cookie

## Rate Limiting

### Overview

Distributed rate limiting using Redis with in-memory fallback for high availability. The system supports multiple rate limit tiers and ensures consistent rate limiting across multiple application instances.

### Configuration

Set these environment variables:

```bash
# Redis connection (required for distributed rate limiting)
REDIS_URL=redis://localhost:6379

# Optional: OpenTelemetry collector for tracing
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

### Rate Limit Tiers

Tier-based rate limiting per endpoint type:

| Tier      | Max Requests | Time Window | Use Case                    |
| --------- | ------------ | ----------- | --------------------------- |
| PUBLIC    | 300          | 1 minute    | Health, donations, contacts |
| ADMIN     | 100          | 1 minute    | Admin endpoints             |
| WEBHOOK   | 500          | 1 minute    | Stripe webhooks             |
| STRICT    | 20           | 1 minute    | Login endpoints             |
| ABUSE     | 5            | 1 minute    | Detected abuse              |
| VIP_ADMIN | 500          | 1 minute    | VIP admin users             |
| API_KEY   | 1000         | 1 minute    | API key authentication      |
| DDOS      | 10           | 1 minute    | DDoS protection             |

### Development

When Redis is not available, the system automatically falls back to in-memory rate limiting. This ensures availability during outages, though it doesn't provide distributed rate limiting across instances.

### Testing

Run tests:

```bash
npm run test:unit              # Unit tests
npm run test:integration         # Integration tests (requires Docker)
npm run test:load                # Load tests (requires k6)
```

### Monitoring

Rate limiting metrics are defined in `src/observability/metrics/rate-limiting-metrics.ts` using prom-client and exposed via `GET /metrics` in Prometheus exposition format. Available metrics:

- `rate_limit_checks_total`: Total number of rate limit checks
- `rate_limit_check_duration_seconds`: Histogram of check durations
- `rate_limit_fallbacks_total`: Number of fallback activations

### Response Headers

Headers included in responses:

- `X-RateLimit-Limit`: Max requests for tier
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Timestamp when limit resets

## Testing

```bash
# Run unit tests
npm run test:unit

# Run integration tests (requires Docker)
npm run test:integration

# Run E2E tests (requires Playwright installation)
npm run test:e2e

# Run load tests (requires k6 installation)
npm run test:load

# Generate coverage report
npm run test:coverage
```

### Coverage Targets

Coverage targets are aspirational; actual coverage is still being improved:
- **Lines**: 98% (target)
- **Functions**: 98% (target)
- **Branches**: 95% (target)
- **Statements**: 98% (target)

## Monitoring

### Prometheus

- **Metrics**: `GET /metrics` (Prometheus exposition format)
- **Dashboard**: http://localhost:3001 (Grafana, when using docker-compose.monitoring.yml)

### Grafana Dashboards

Access at http://localhost:3001 (admin/admin):

- Rate Limiting Production dashboard (`monitoring/grafana/dashboards/rate-limiting-production.json`)

### Key Metrics

- Request rate by endpoint
- Response time percentiles (p50, p95, p99)
- Error rate (4xx, 5xx)
- Database query performance
- Cache hit rate
- Donation metrics (creation rate, success rate, total amount)
- Admin authentication metrics

## Infrastructure

### Docker Compose

```bash
# Start all services (PostgreSQL, Redis, Backend)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Monitoring Stack (Docker)

```bash
# Start monitoring services (Prometheus, Grafana, Alertmanager)
docker-compose -f docker-compose.monitoring.yml up -d
```

## Capacity Planning

Estimated capacity (not yet validated via load testing):

| Endpoint                   | Est. Capacity (RPS) | Notes                 |
| -------------------------- | -------------------- | --------------------- |
| GET /api/health            | ~1000                | Baseline              |
| POST /api/contacts         | ~100                 | Limited by DB writes  |
| POST /api/donations/intent | ~100                 | Limited by Stripe API |
| GET /api/admin/dashboard   | ~50                  | With Redis cache      |
| GET /api/admin/donations   | ~50                  | Pagination queries    |

## Project Structure

```
src/
├── api/                 # API routes and schemas
│   ├── routes/          # Fastify route definitions
│   └── schemas/         # Zod/OpenAPI schemas
├── auth/                # Authentication logic
├── cache/               # Redis caching layer
├── config/              # Configuration and environment
├── db/                  # Database connection
├── errors/              # Custom error classes
├── http/                # HTTP response helpers
├── observability/       # OpenTelemetry, logging
├── rate-limiting/       # Rate limiting and abuse detection
├── repositories/         # Database access layer
├── services/             # Business logic
├── utils/               # Utilities (cursor, etc.)
├── webhooks/            # Webhook handlers
└── app.ts               # Application setup

tests/
├── e2e/                 # End-to-end tests (Playwright)
│   ├── fixtures/pages/
│   └── specs/
├── helpers/              # Test helpers
├── integration/           # Integration tests
├── mocks/                # Mock factories
├── fixtures/             # Test data fixtures
└── unit/                 # Unit tests
```

## Development

### Running Tests

```bash
# Unit tests only
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Code Quality

```bash
# Lint
npm run lint

# Format
npm run format

# Typecheck
npm run build
```

## Deployment

### Environment Variables

Required:

- `NODE_ENV`: development | test | production
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT signing (min 32 chars)
- `COOKIE_SECRET`: Secret for cookie signing (min 16 chars)
- `STRIPE_SECRET_KEY`: Stripe API secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret
- `STRIPE_API_VERSION`: Stripe API version (e.g., 2024-01-01)
- `CORS_ORIGIN`: Allowed CORS origins

Optional:

- `REDIS_URL`: Redis connection string (for caching)
- `OTEL_EXPORTER_OTLP_ENDPOINT`: OpenTelemetry collector endpoint
- `DB_SLOW_MS`: Slow query threshold (ms)
- `DB_POOL_MAX`: Connection pool maximum size (default: 20)
- `DB_POOL_IDLE_TIMEOUT`: Connection pool idle timeout in ms (default: 20000)

### Production Checklist

- [ ] Set strong secrets (JWT_SECRET, COOKIE_SECRET)
- [ ] Configure production Stripe keys
- [ ] Set up Redis for caching
- [ ] Configure CORS_ORIGIN appropriately
- [ ] Enable monitoring (Prometheus + Grafana)
- [ ] Set up alerts (Alertmanager)
- [ ] Run load tests to verify capacity
- [ ] Configure autoscaling based on metrics
- [ ] Set up log aggregation (e.g., CloudWatch, ELK)
- [ ] Enable HTTPS/SSL
- [ ] Configure backup strategy for PostgreSQL

## License

MIT
