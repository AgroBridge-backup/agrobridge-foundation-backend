# Error Observability Model

## Overview

This document describes the structured error observability system implemented for the AgroBridge Foundation backend. The system provides comprehensive error classification, metrics collection, and alerting to enable rapid incident response.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Error Occurs                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Error Classification Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Prisma/DB    │  │ Stripe API   │  │ Custom AppError      │   │
│  │ Errors       │  │ Errors       │  │ Business Logic       │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Error Taxonomy Assignment                           │
│                                                                  │
│  Code: INFRA_DB_CONNECTION                                       │
│  Category: INFRASTRUCTURE                                        │
│  Severity: critical                                              │
│  HTTP Status: 503                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Metrics Collection                                  │
│                                                                  │
│  • error_rate_total{category,code,severity}                      │
│  • error_latency_seconds{category}                              │
│  • error_user_impact{category,endpoint}                         │
│  • error_rate_per_minute{category,severity}                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Alerting & Dashboards                               │
│                                                                  │
│  Prometheus Alerts ──► PagerDuty/Slack                          │
│  Grafana Dashboard ──► Real-time visualization                  │
└─────────────────────────────────────────────────────────────────┘
```

## Error Taxonomy

### Categories

| Category | Description | Example Codes |
|----------|-------------|---------------|
| **INFRASTRUCTURE** | System-level failures | `INFRA_DB_CONNECTION`, `INFRA_REDIS_TIMEOUT` |
| **VENDOR** | Third-party service failures | `VENDOR_STRIPE_API`, `VENDOR_EMAIL_SERVICE` |
| **APPLICATION** | Business logic and code bugs | `APP_VALIDATION`, `APP_CODE_BUG` |
| **SECURITY** | Authentication, authorization, attacks | `SEC_SQL_INJECTION`, `SEC_RATE_LIMIT_EXCEEDED` |
| **CLIENT** | Client-side errors | `CLIENT_BAD_REQUEST`, `CLIENT_NOT_FOUND` |

### Severity Levels

| Severity | Response Time | Alert Channel | Examples |
|----------|--------------|---------------|----------|
| **critical** | Immediate (5 min) | PagerDuty + Slack | DB down, security breach |
| **high** | 30 minutes | Slack #alerts | Stripe API failing |
| **medium** | 4 hours | Slack #warnings | Validation errors |
| **low** | Next business day | Dashboard only | Minor client errors |
| **info** | No action | Logs only | 404s, bad requests |

## Error Classification

### Automatic Classification

The system automatically classifies errors based on error type:

```typescript
// Database errors → INFRASTRUCTURE
try {
  await prisma.donation.findMany();
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Automatically classified as INFRA_DB_CONNECTION
  }
}

// Stripe errors → VENDOR
try {
  await stripe.paymentIntents.create(params);
} catch (err) {
  if (err instanceof Stripe.errors.StripeError) {
    // Automatically classified as VENDOR_STRIPE_API
  }
}
```

### Manual Classification

For custom errors, use the `AppError` class with taxonomy mapping:

```typescript
import { AppError, Errors } from './errors/app-error.js';

// This will be classified as APP_BUSINESS_LOGIC
throw Errors.conflict('Campaign already exists');
```

## Metrics

### Core Metrics

#### `error_rate_total`
Counter of errors with dimensions:
- `category`: INFRASTRUCTURE, VENDOR, APPLICATION, SECURITY, CLIENT
- `code`: Specific error code (e.g., INFRA_DB_CONNECTION)
- `severity`: critical, high, medium, low, info
- `endpoint`: API endpoint path

**PromQL Example:**
```promql
# Error rate by category over 5 minutes
sum by (category) (rate(error_rate_total[5m]))

# Critical errors only
sum(rate(error_rate_total{severity="critical"}[5m]))

# Errors by specific endpoint
sum by (code) (rate(error_rate_total{endpoint="/api/donations"}[5m]))
```

#### `error_latency_seconds`
Histogram of error response latency:
- Tracks how long it takes to return error responses
- Buckets: 1ms to 10s

**PromQL Example:**
```promql
# 95th percentile error latency by category
histogram_quantile(0.95, 
  sum by (category, le) (rate(error_latency_seconds_bucket[5m]))
)
```

#### `error_user_impact`
Counter of users affected by errors:
- `category`: Error category
- `endpoint`: Affected endpoint
- `user_type`: anonymous, authenticated, admin

**PromQL Example:**
```promql
# Total users affected in last hour
sum(increase(error_user_impact_total[1h]))

# Breakdown by endpoint
sum by (endpoint) (rate(error_user_impact_total[5m]))
```

### Derived Metrics

#### Error Rate Percentage
```promql
# Overall error rate as percentage
(
  sum(rate(error_rate_total[5m])) 
  / 
  sum(rate(http_requests_total[5m]))
) * 100
```

#### Error Budget Burn Rate
```promql
# 1-hour burn rate
(
  sum(rate(error_rate_total[1h])) 
  / 
  sum(rate(http_requests_total[1h]))
) > 0.01  # Alert if > 1%
```

## Alerting Rules

### Critical Alerts (Immediate Response)

| Alert | Condition | Action |
|-------|-----------|--------|
| DatabaseConnectionFailure | Any DB connection error | Page on-call SRE |
| PaymentGatewayFailure | Any payment gateway error | Page payments team |
| SQLInjectionAttempt | Any SQL injection detected | Page security team |
| ErrorBudgetExhausted | >5% error rate over 24h | Page on-call SRE |

### Warning Alerts (Business Hours)

| Alert | Condition | Action |
|-------|-----------|--------|
| DatabaseTimeouts | >0.1/sec for 2 minutes | Review slow queries |
| StripeAPIFailure | >0.1/sec for 2 minutes | Check Stripe status |
| ApplicationBugs | >0.5/sec for 3 minutes | Review recent deploys |

### Alert Routing

```yaml
# Critical alerts → PagerDuty
severity: critical → pagerduty-critical

# Security alerts → Security team + SRE
category: security → security-team, sre

# Vendor alerts → Payments team
category: vendor → payments-team

# All others → Slack
default → #alerts
```

## Dashboards

### Grafana Dashboard: Error Observability

**URL:** `https://grafana.internal/d/agrobridge-errors`

**Sections:**

1. **Overview** (Top row)
   - Total error rate (5m)
   - Critical errors count
   - Infrastructure errors
   - Security events
   - Error rate percentage
   - Users affected (1h)

2. **Error Trends** (Middle)
   - Error rate by category over time
   - Error rate by severity (stacked)

3. **Top Errors** (Table)
   - Top 10 error codes by rate
   - Color-coded by severity

4. **Infrastructure Errors** (Bottom left)
   - DB connection failures
   - Redis errors
   - Network issues

5. **Vendor Errors** (Bottom center)
   - Stripe API errors
   - Email service failures
   - Third-party API issues

6. **Security Events** (Bottom right)
   - Attack attempts (XSS, SQLi, CSRF)
   - Authentication failures
   - Suspicious activity

## Integration

### In Application Code

The error observability system is automatically integrated via the Fastify error handler:

```typescript
// src/app.ts
import { handleErrorWithObservability } from './middleware/error-observability.js';

app.setErrorHandler((err, req, reply) => {
  // This automatically:
  // 1. Classifies the error
  // 2. Records metrics
  // 3. Updates OpenTelemetry spans
  // 4. Logs with structured context
  const classified = handleErrorWithObservability(err, req, reply);
  
  // Return appropriate response
  return reply.status(classified.httpStatus).send({
    error: classified.code,
    message: classified.message,
  });
});
```

### Manual Error Recording

For custom error tracking outside the HTTP flow:

```typescript
import { recordError } from './observability/error-metrics.js';

// Record a custom error
recordError({
  category: 'VENDOR',
  code: 'VENDOR_EMAIL_SERVICE',
  severity: 'medium',
  endpoint: 'background-job',
  latencyMs: 5000,
});
```

## Runbooks

### Database Connection Failure

**Symptoms:**
- Alert: `DatabaseConnectionFailure`
- Error code: `INFRA_DB_CONNECTION`
- Metric spike in `error_rate_total{code="INFRA_DB_CONNECTION"}`

**Diagnosis:**
1. Check RDS/Database status in AWS console
2. Verify connection pool metrics
3. Check for connection leaks in application

**Resolution:**
1. If DB is down: Failover to standby
2. If pool exhausted: Restart application to clear connections
3. If leak: Deploy fix and restart

**Prevention:**
- Set appropriate pool size limits
- Use connection timeouts
- Monitor pool utilization

### Stripe API Failure

**Symptoms:**
- Alert: `StripeAPIFailure`
- Error code: `VENDOR_STRIPE_API`
- Donations failing

**Diagnosis:**
1. Check Stripe status page
2. Verify API keys and configuration
3. Check webhook endpoints

**Resolution:**
1. If Stripe is down: Enable queue for retry
2. If configuration issue: Update env vars
3. If rate limiting: Implement backoff

**Prevention:**
- Use idempotency keys
- Implement circuit breaker
- Monitor Stripe webhooks

### SQL Injection Attempt

**Symptoms:**
- Alert: `SQLInjectionAttempt`
- Error code: `SEC_SQL_INJECTION`
- Security event logged

**Diagnosis:**
1. Check request logs for malicious payloads
2. Verify input validation is working
3. Check if any queries were executed

**Resolution:**
1. Block source IP if identified
2. Review and strengthen input validation
3. Check for any successful injection

**Prevention:**
- Always use parameterized queries
- Input validation/sanitization
- WAF rules for common patterns

## SLOs

### Error Rate SLO

**Target:** < 1% error rate over 30 days

**Measurement:**
```promql
(
  sum(rate(error_rate_total[30d]))
  /
  sum(rate(http_requests_total[30d]))
) < 0.01
```

**Error Budget:** 5% per quarter

### Alert Threshold

If error rate exceeds 5% over 24 hours:
- Alert severity: critical
- Action: Consider rollback of recent changes

## Best Practices

### For Developers

1. **Always use typed errors**: Use `AppError` or specific error classes
2. **Don't swallow errors**: Let errors bubble up to the error handler
3. **Add context**: Include relevant IDs and parameters in error details
4. **Test error paths**: Include error scenarios in unit tests

### For SREs

1. **Acknowledge alerts quickly**: Even if false positive
2. **Use dashboards**: Verify alert accuracy before acting
3. **Document actions**: Update runbooks with findings
4. **Review trends**: Weekly error rate reviews

### For On-Call

1. **Start with overview**: Check the dashboard first
2. **Identify category**: Is it infra, vendor, or app?
3. **Check severity**: Critical = immediate action
4. **Follow runbooks**: Don't improvise under pressure
5. **Communicate**: Update status page if user impact

## Future Enhancements

### Planned

1. **Error fingerprinting**: Group similar errors automatically
2. **ML-based anomaly detection**: Predict unusual error patterns
3. **Error correlation**: Link related errors across services
4. **Automatic remediation**: Self-healing for known issues

### Ideas

- Error impact scoring (revenue, user experience)
- Automatic JIRA ticket creation for code bugs
- Integration with incident.io for incident management
- Error forecasting based on patterns

## References

- [Error Taxonomy](./src/errors/error-taxonomy.ts)
- [Error Metrics](./src/observability/error-metrics.ts)
- [Error Middleware](./src/middleware/error-observability.ts)
- [Alerting Rules](./alerting/error-alerts.yml)
- [Grafana Dashboard](./dashboards/error-dashboard.json)

---

**Owner:** SRE Team  
**Last Updated:** 2026-02-17  
**Version:** 1.0
