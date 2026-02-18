# Test Infrastructure Documentation

## Overview

This document describes the comprehensive test infrastructure for the AgroBridge Foundation project, including race condition testing, concurrency testing, load testing, security testing, and contract testing.

**Author:** Alejandro Navarro Ayala - CEO & Founder, AgroBridge  
**Version:** 1.0.0  
**Last Updated:** February 2026

---

## Table of Contents

1. [Test Infrastructure Architecture](#test-infrastructure-architecture)
2. [Backend Test Infrastructure](#backend-test-infrastructure)
3. [Frontend Test Infrastructure](#frontend-test-infrastructure)
4. [Load Testing](#load-testing)
5. [Security Testing](#security-testing)
6. [Contract Testing](#contract-testing)
7. [Concurrency & Race Condition Testing](#concurrency--race-condition-testing)
8. [Test Data Factories](#test-data-factories)
9. [Performance Monitoring](#performance-monitoring)
10. [Running Tests](#running-tests)
11. [CI/CD Integration](#cicd-integration)

---

## Test Infrastructure Architecture

```
tests/
├── load/                          # Load testing configurations
│   ├── artillery-config.yml       # Main Artillery configuration
│   └── scenarios/
│       ├── auth-load.yml          # Auth endpoint load tests
│       └── donation-load.yml      # Donation endpoint load tests
├── security/                      # Security test suites
│   ├── attack-patterns.js         # Common attack payloads library
│   ├── xss-payloads.json          # XSS test payloads
│   └── sql-injection-payloads.json # SQL injection payloads
├── helpers/                       # Test utilities
│   ├── factories/                 # Test data factories
│   │   ├── admin-user-factory.ts
│   │   ├── donation-factory.ts
│   │   └── contact-factory.ts
│   ├── concurrency-runner.ts      # Concurrency test helper
│   └── performance-tracker.ts     # Performance monitoring
└── integration/                   # Integration tests
```

---

## Backend Test Infrastructure

### Load Testing with Artillery

The backend uses Artillery for load testing with support for:
- **Gradual ramp-up patterns** - Simulates real-world traffic growth
- **Sustained load testing** - Validates system stability under load
- **Peak load simulation** - Tests maximum capacity scenarios
- **Recovery testing** - Validates graceful degradation

#### Configuration

```yaml
# tests/load/artillery-config.yml
config:
  target: '{{ $processEnvironment.API_URL }}'
  phases:
    - duration: 60
      arrivalRate: 5
      rampTo: 50
      name: 'Warm-up Phase'
    - duration: 300
      arrivalRate: 50
      name: 'Sustained Load Phase'
```

#### Running Load Tests

```bash
# Auth endpoint load test
artillery run -c tests/load/artillery-config.yml tests/load/scenarios/auth-load.yml

# Donation endpoint load test
artillery run -c tests/load/artillery-config.yml tests/load/scenarios/donation-load.yml

# Production environment
artillery run -e production -c tests/load/artillery-config.yml tests/load/scenarios/donation-load.yml
```

### Security Test Library

The security testing infrastructure includes:

#### Attack Patterns (`tests/security/attack-patterns.js`)

Comprehensive attack payload library including:
- **XSS (Cross-Site Scripting)** - 50+ payloads including encoded variants
- **SQL Injection** - Classic, union-based, blind, time-based, NoSQL
- **Command Injection** - Shell command execution payloads
- **Path Traversal** - File system access attempts
- **XXE (XML External Entity)** - XML injection attacks
- **SSRF (Server-Side Request Forgery)** - Internal network access
- **CSRF (Cross-Site Request Forgery)** - Session hijacking
- **Open Redirect** - URL redirection attacks
- **JWT Attacks** - Token manipulation and algorithm confusion
- **File Upload Attacks** - Malicious file uploads

#### Usage Example

```typescript
import { getPayloads, xssPayloads } from '../security/attack-patterns.js';

// Get all XSS payloads
const xssTests = xssPayloads;

// Get specific attack type
const sqlPayloads = getPayloads('sql-injection');

// Test endpoint with attack payloads
for (const payload of xssPayloads) {
  const response = await request(app)
    .post('/api/contact')
    .send({ message: payload });
  
  expect(response.status).not.toBe(200);
}
```

---

## Frontend Test Infrastructure

### Contract Testing

Validates API contract compliance between frontend and backend.

```bash
# Run contract tests
npm run test -- tests/contract/backend-contract.test.js
```

Tests include:
- Schema validation for all API endpoints
- Request/response format compliance
- HTTP status code validation
- CORS headers verification
- Content-Type validation
- Error response format checking

### Security Testing

Frontend XSS protection tests:

```bash
# Run XSS security tests
npm run test -- tests/security/frontend-xss.test.js
```

Covers:
- InnerHTML script execution prevention
- TextContent safety
- Attribute sanitization
- URL parameter handling
- LocalStorage/sessionStorage protection
- Template injection prevention
- CSP compliance

### Load Testing with k6

Frontend performance under load:

```bash
# Run k6 load tests
k6 run tests/load/k6-config.js

# With custom environment variables
BASE_URL=http://localhost:5173 API_URL=http://localhost:3000 k6 run tests/load/k6-config.js
```

---

## Load Testing

### Backend Load Tests

#### Auth Endpoint Load Test

Tests authentication endpoints under load:
- Login flow (70% of traffic)
- Token refresh (20% of traffic)
- Registration (10% of traffic)
- Concurrent login race conditions
- Rate limit testing
- MFA challenge flow

```bash
artillery run tests/load/scenarios/auth-load.yml
```

**Metrics:**
- Response time p95 < 500ms
- Error rate < 1%
- Success rate > 99%

#### Donation Endpoint Load Test

Tests donation processing under load:
- One-time donations (60% of traffic)
- Recurring donations (25% of traffic)
- Campaign deadline spikes
- Concurrent donation races
- Double-click protection
- Webhook processing load

```bash
artillery run tests/load/scenarios/donation-load.yml
```

**Metrics:**
- Response time p95 < 1000ms
- Donation success rate > 99.5%
- Webhook processing < 500ms

### Frontend Load Tests

k6 tests simulate real user behavior:
- Homepage loading
- Static asset delivery
- API calls
- Donation flow completion
- Contact form submission

**Stages:**
1. Ramp up to 50 users (2 min)
2. Sustained 50 users (5 min)
3. Ramp up to 200 users (2 min)
4. Sustained 200 users (5 min)
5. Peak load 500 users (7 min)
6. Ramp down (3 min)

---

## Security Testing

### XSS Payload Categories

1. **Basic Script Injection** - `<script>alert('XSS')</script>`
2. **Encoded XSS** - URL encoded, HTML entity encoded
3. **Event Handlers** - `onerror`, `onload`, `onfocus`
4. **JavaScript Protocol** - `javascript:alert('XSS')`
5. **DOM-based XSS** - Object/embed injection
6. **Polyglot Payloads** - Multiple context exploits
7. **Obfuscated XSS** - Filter bypass techniques
8. **Template Injection** - Angular, EJS, template literals
9. **Data Exfiltration** - Cookie theft attempts
10. **WAF Bypass** - Null bytes, encoding tricks

### SQL Injection Categories

1. **Classic SQLi** - `OR 1=1`, comment-based
2. **Union-based** - Data extraction via UNION
3. **Error-based** - Information disclosure
4. **Time-based Blind** - SLEEP(), pg_sleep()
5. **Boolean-based Blind** - True/false inference
6. **Stacked Queries** - Multiple statement execution
7. **NoSQL Injection** - MongoDB injection
8. **Database-specific** - MySQL, PostgreSQL, MSSQL, Oracle

### Running Security Tests

```bash
# Backend security tests
npm run test:security

# XSS specific
npm run test -- tests/security/xss-protection.test.ts

# SQL injection specific
npm run test -- tests/security/sql-injection.test.ts

# Frontend security
npm run test -- tests/security/frontend-xss.test.js
```

---

## Contract Testing

### API Contract Validation

Validates that the API adheres to the defined contract:

```typescript
// Example contract definition
const authContract = {
  login: {
    endpoint: '/api/auth/login',
    method: 'POST',
    requestSchema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 8 }
      }
    },
    responseSchema: {
      type: 'object',
      required: ['token', 'user'],
      properties: {
        token: { type: 'string' },
        user: {
          type: 'object',
          required: ['id', 'email'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' }
          }
        }
      }
    }
  }
};
```

### Running Contract Tests

```bash
# Full contract test suite
npm run test:contract

# Specific endpoint contract
npm run test -- tests/contract/auth-contract.test.ts
```

---

## Concurrency & Race Condition Testing

### Concurrency Runner

The `concurrency-runner.ts` provides utilities for testing concurrent operations:

```typescript
import { concurrencyRunner, simulateRaceCondition } from '../helpers/concurrency-runner.js';

// Run operations concurrently
const report = await concurrencyRunner.runConcurrent([
  { name: 'create-donation-1', operation: () => createDonation(donation1) },
  { name: 'create-donation-2', operation: () => createDonation(donation2) },
  { name: 'create-donation-3', operation: () => createDonation(donation3) }
], {
  maxConcurrency: 3,
  timeout: 10000
});

// Detect race conditions
if (report.raceConditions.length > 0) {
  console.error('Race conditions detected:', report.raceConditions);
}

// Assert no race conditions
concurrencyRunner.assertNoRaceConditions(report);
```

### Race Condition Detection

The runner automatically detects:
- **Duplicate results** - Same result from concurrent operations
- **Inconsistent states** - Partial failures
- **Lost updates** - Very fast consecutive operations
- **Dirty reads** - High contention scenarios

### Idempotency Testing

```typescript
import { testIdempotency } from '../helpers/concurrency-runner.js';

// Test if operation is idempotent
const idempotencyResult = await testIdempotency(
  () => createDonation({ idempotencyKey: 'unique-key' }),
  { times: 5, expectSameResult: true }
);

if (!idempotencyResult.isIdempotent) {
  console.error('Operation is not idempotent:', idempotencyResult.differences);
}
```

---

## Test Data Factories

### Admin User Factory

Creates test admin users with various configurations:

```typescript
import { adminUserFactory } from '../helpers/factories/admin-user-factory.js';

// Create standard admin
const admin = await adminUserFactory.create({
  email: 'admin@test.com',
  role: 'ADMIN'
});

// Create super admin
const superAdmin = await adminUserFactory.createSuperAdmin();

// Create with specific permissions
const limitedAdmin = await adminUserFactory.createWithPermissions([
  'read:donations',
  'read:campaigns'
]);

// Create concurrent users for race testing
const concurrentAdmins = await adminUserFactory.createConcurrent(10);

// Cleanup after tests
await adminUserFactory.cleanup();
```

### Donation Factory

Creates test donations:

```typescript
import { donationFactory } from '../helpers/factories/donation-factory.js';

// Create one-time donation
const donation = await donationFactory.createOneTime({
  amount: 100,
  currency: 'USD',
  campaignId: 'campaign-123'
});

// Create recurring donation
const recurring = await donationFactory.createRecurring('monthly', {
  amount: 50
});

// Create anonymous donation
const anonymous = await donationFactory.createAnonymous();

// Create concurrent donations for race testing
const concurrentDonations = await donationFactory.createConcurrent(5, {
  campaignId: 'race-test-campaign'
});

// Cleanup
await donationFactory.cleanup();
```

### Contact Factory

Creates test contact form submissions:

```typescript
import { contactFactory } from '../helpers/factories/contact-factory.js';

// Create standard contact
const contact = await contactFactory.create({
  name: 'Test User',
  email: 'test@example.com',
  subject: 'Test Subject',
  message: 'Test message'
});

// Create high priority
const urgent = await contactFactory.createHighPriority();

// Create partnership inquiry
const partnership = await contactFactory.createPartnership();

// Create volunteer application
const volunteer = await contactFactory.createVolunteer();

// Cleanup
await contactFactory.cleanup();
```

---

## Performance Monitoring

### Performance Tracker

Monitors test performance metrics:

```typescript
import { performanceTracker, trackPerformance } from '../helpers/performance-tracker.js';

// Method 1: Manual tracking
performanceTracker.startTest('my-test');
// ... run test ...
const snapshot = performanceTracker.endTest();

// Method 2: Decorator
class MyTests {
  @trackPerformance({ maxDuration: 5000, maxHeapUsed: 100 * 1024 * 1024 })
  async myTest() {
    // Test implementation
  }
}

// Method 3: Time specific operations
const result = await performanceTracker.timeOperation(
  'database-query',
  () => db.query('SELECT * FROM donations'),
  { endpoint: '/api/donations' }
);

// Check thresholds
performanceTracker.assertThresholds(snapshot, {
  maxDuration: 5000,
  maxMemoryIncrease: 50 * 1024 * 1024
});
```

### Benchmarking

```typescript
import { benchmark } from '../helpers/performance-tracker.js';

// Benchmark an operation
const results = await benchmark(
  'donation-creation',
  () => donationFactory.create(),
  100 // iterations
);

console.log(`
  Average: ${results.avgTime}ms
  Min: ${results.minTime}ms
  Max: ${results.maxTime}ms
  Ops/sec: ${results.opsPerSecond}
`);
```

### Exporting Metrics

```typescript
// Prometheus format
const prometheusMetrics = performanceTracker.exportPrometheusMetrics();

// JSON format
const jsonReport = performanceTracker.exportJSON();
```

---

## Running Tests

### Backend Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Load tests
npm run test:load

# Security tests
npm run test:security

# Contract tests
npm run test:contract

# All tests
npm run test:all

# With coverage
npm run test:coverage
```

### Frontend Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Load tests (k6)
k6 run tests/load/k6-config.js

# Contract tests
npm run test -- tests/contract/backend-contract.test.js

# Security tests
npm run test -- tests/security/frontend-xss.test.js

# All tests
npm run test:all
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run unit tests
        run: npm run test:unit
        
      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379
          
      - name: Run security tests
        run: npm run test:security
        
      - name: Run contract tests
        run: npm run test:contract
        env:
          API_URL: http://localhost:3000
          
      - name: Load test (smoke)
        run: npm run test:load:smoke
```

### Test Stages

1. **Pre-commit** - Unit tests, linting
2. **PR** - Unit + Integration + Security tests
3. **Staging** - Full load tests, contract tests
4. **Production** - Smoke tests, monitoring

---

## Performance Thresholds

### Backend

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Response Time (p95) | < 200ms | < 500ms | > 500ms |
| Response Time (p99) | < 500ms | < 1000ms | > 1000ms |
| Error Rate | < 0.1% | < 1% | > 1% |
| Concurrent Users | 1000 | 2000 | > 2000 |
| Memory Usage | < 512MB | < 1GB | > 1GB |

### Frontend

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Page Load (LCP) | < 2.5s | < 4s | > 4s |
| First Input Delay (FID) | < 100ms | < 300ms | > 300ms |
| Cumulative Layout Shift (CLS) | < 0.1 | < 0.25 | > 0.25 |
| Bundle Size (JS) | < 200KB | < 500KB | > 500KB |
| Lighthouse Performance | > 90 | > 70 | < 70 |

---

## Best Practices

### Writing Tests

1. **Use factories** for consistent test data
2. **Clean up** after each test
3. **Mock external services** (Stripe, email)
4. **Test edge cases** and boundary values
5. **Use descriptive test names**
6. **Keep tests isolated**
7. **Document complex scenarios**

### Load Testing

1. **Warm up** before peak load
2. **Monitor system metrics** during tests
3. **Test realistic scenarios**
4. **Include think time** between requests
5. **Validate business metrics** (donation success rate)

### Security Testing

1. **Test all input vectors** (query, body, headers)
2. **Use comprehensive payload libraries**
3. **Test with different contexts** (HTML, JS, URL)
4. **Verify sanitization output**
5. **Test authentication/authorization**

### Concurrency Testing

1. **Identify critical sections** (donations, user creation)
2. **Use high concurrency** to trigger races
3. **Verify data consistency** after concurrent operations
4. **Test idempotency** keys
5. **Check for deadlocks**

---

## Troubleshooting

### Common Issues

**Issue:** Tests fail with database connection errors
- **Solution:** Ensure test database is running and accessible

**Issue:** Load tests fail with connection errors
- **Solution:** Increase ulimit for open files: `ulimit -n 65535`

**Issue:** Security tests take too long
- **Solution:** Run with reduced payload set for CI: `npm run test:security:quick`

**Issue:** Race condition tests are flaky
- **Solution:** Increase concurrency and add retry logic

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run test

# Debug specific test
npm run test -- tests/security/xss.test.ts --verbose

# Artillery debug
DEBUG=artillery* artillery run tests/load/scenarios/auth-load.yml
```

---

## Contributing

When adding new tests:

1. Follow existing naming conventions
2. Add to appropriate category (unit, integration, load, security)
3. Update this documentation
4. Include test coverage in PR
5. Verify tests pass in CI

---

## Resources

- [Artillery Documentation](https://www.artillery.io/docs)
- [k6 Documentation](https://k6.io/docs/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)

---

## Support

For questions or issues with the test infrastructure:

1. Check this documentation
2. Review existing test examples
3. Contact the engineering team
4. Create an issue in the project repository

---

**End of Document**