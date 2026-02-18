# Sentry Error Tracking Setup Guide

## Overview

Sentry provides real-time error tracking and performance monitoring for the AgroBridge Foundation backend.

## Prerequisites

- Sentry account (free tier available): https://sentry.io/signup/
- Backend access

## Setup Steps

### 1. Create Sentry Project

1. Visit: https://sentry.io/signup/
2. Sign up for free account (up to 5,000 errors/month)
3. Create new project:
   - Platform: Node.js
   - Project Name: agrobridge-backend
4. Copy the DSN (Data Source Name)

### 2. Configure Environment Variables

Add to backend `.env` file:
```bash
SENTRY_DSN=https://YOUR_DSN@sentry.io/PROJECT_ID
SENTRY_ENVIRONMENT=production
```

### 3. Restart Backend

```bash
cd /var/www/agrobridge-foundation-backend
pm2 reload agrobridge-backend
```

### 4. Verify Sentry Integration

1. Trigger an error (e.g., access invalid endpoint)
2. Check Sentry dashboard: https://sentry.io/
3. Verify error appears in Sentry

## Features

### Error Tracking
- Automatic error capture from unhandled exceptions
- Custom error reporting with `captureError()`
- Automatic stack traces

### Performance Monitoring
- Request/response times
- Database query performance
- Transaction traces
- Profile analysis

### Alerting
- Email alerts on new errors
- Slack/Discord integration
- Webhook notifications

## Usage Examples

### Capture Custom Error

```typescript
import { captureError } from "./lib/sentry";

try {
  // Your code
} catch (error) {
  captureError(error as Error, {
    userId: "user-123",
    action: "donation",
  });
}
```

### Capture Custom Message

```typescript
import { captureMessage } from "./lib/sentry";

captureMessage("User completed donation", "info");
```

### Add Context to Errors

```typescript
Sentry.withScope((scope) => {
  scope.setUser({ id: "user-123", email: "user@example.com" });
  scope.setContext("donation", {
    amount: 35,
    currency: "usd",
  });
  Sentry.captureException(error);
});
```

## Monitoring Dashboard

Access at: https://sentry.io/projects/agrobridge-backend/

## Troubleshooting

### Errors Not Appearing in Sentry

1. Check `SENTRY_DSN` is set in `.env`
2. Verify backend restarted after configuration
3. Check network connectivity to Sentry servers
4. Review backend logs for Sentry initialization errors

### Too Many Errors

1. Implement ignore rules in Sentry configuration
2. Filter common errors (health checks, etc.)
3. Set up sampling rates for performance monitoring

### Performance Issues

1. Reduce `tracesSampleRate` in production
2. Disable session replay if not needed
3. Profile database queries to identify bottlenecks

## Best Practices

1. Review errors daily
2. Set up alert notifications
3. Investigate high-impact errors first
4. Use error context for debugging
5. Track error trends over time
6. Set up SLOs (Service Level Objectives)
7. Create custom release tracking

## Pricing

- Free Tier: 5,000 errors/month, 100 GB attachments
- Developer: $26/month, 100,000 errors/month
- Team: $80/month, 400,000 errors/month

## Support

- Documentation: https://docs.sentry.io/
- Support: https://sentry.io/support/
