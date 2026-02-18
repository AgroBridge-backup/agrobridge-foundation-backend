# Atomic Rate Limiting Pattern

## Overview

This document describes the atomic rate limiting pattern implemented in AgroBridge Foundation to prevent Time-of-Check-Time-of-Use (TOCTOU) race conditions in login rate limiting.

## The Problem: TOCTOU Vulnerability

### Traditional Approach (Vulnerable)

```typescript
// VULNERABLE: Separate check and record operations
async function handleLogin(ip: string, credentials: Credentials) {
  // Time-of-Check: Read current state
  const limit = await rateLimiter.checkLimit(ip);
  
  if (!limit.allowed) {
    return { error: 'Rate limit exceeded' };
  }
  
  // ... perform login attempt ...
  const result = await attemptLogin(credentials);
  
  if (!result.success) {
    // Time-of-Use: Record failure (RACE CONDITION HERE!)
    await rateLimiter.recordFailedAttempt(ip);
  }
  
  return result;
}
```

### The Race Condition

With concurrent requests, the following can happen:

```
Time →

Request 1: checkLimit() → allowed: true (0 attempts)
Request 2: checkLimit() → allowed: true (0 attempts)  [Race!]
Request 3: checkLimit() → allowed: true (0 attempts)  [Race!]
...
Request 100: checkLimit() → allowed: true (0 attempts) [Race!]

Request 1: recordFailedAttempt() → 1 attempt recorded
Request 2: recordFailedAttempt() → 2 attempts recorded
...
Request 100: recordFailedAttempt() → 100 attempts recorded
```

**Result**: 100 login attempts allowed when only 5 should be permitted!

## The Solution: Atomic Check-and-Record

### Single Operation Pattern

```typescript
// SECURE: Atomic check and record
async function handleLogin(ip: string, credentials: Credentials) {
  // Atomically check AND record in one operation
  const result = await rateLimiter.checkAndRecord(ip, true);
  
  if (!result.allowed) {
    return { 
      error: 'Rate limit exceeded',
      retryAfterMs: result.retryAfterMs 
    };
  }
  
  // ... perform login attempt ...
  return await attemptLogin(credentials);
}
```

## Implementation Strategies

### 1. In-Memory Locking (Single Instance)

For single-server deployments, use per-IP mutex locks:

```typescript
import { Mutex } from 'async-mutex';

class RateLimiter {
  private locks = new Map<string, Mutex>();
  
  async checkAndRecord(ip: string, recordFailure: boolean): Promise<Result> {
    const lock = this.getLockForIp(ip);
    
    return lock.runExclusive(() => {
      // Critical section: Only one request per IP can execute here
      const record = this.getRecord(ip);
      
      if (this.isBlocked(record)) {
        return { allowed: false, ... };
      }
      
      if (recordFailure) {
        this.incrementAttempts(record);
      }
      
      return { allowed: true, ... };
    });
  }
}
```

**Pros:**
- Simple implementation
- Low latency (in-memory only)
- No external dependencies

**Cons:**
- Only works on single instance
- Locks consume memory (mitigated by cleanup)

### 2. Redis Lua Scripts (Distributed)

For multi-instance deployments, use Redis with atomic Lua scripts:

```lua
-- Atomic rate limiting Lua script
local key = KEYS[1]
local max_attempts = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local record_failure = tonumber(ARGV[3])

-- All Redis operations in Lua are atomic
local record = redis.call('GET', key)
-- ... check and update logic ...

if record_failure == 1 then
  redis.call('SET', key, updated_record, 'PX', ttl)
end

return { allowed, attempts_remaining, retry_after }
```

**Pros:**
- Works across distributed instances
- True atomicity via Redis single-threaded execution
- Shared state between servers

**Cons:**
- Network latency
- Redis dependency
- More complex error handling

### 3. Database Atomic Operations

For persistence requirements, use database atomic operations:

```typescript
// PostgreSQL with advisory locks
await prisma.$transaction(async (tx) => {
  // Acquire advisory lock on IP
  await tx.$executeRaw`SELECT pg_advisory_lock(hashtext(${ip}))`;
  
  try {
    const record = await tx.rateLimit.findUnique({ where: { ip } });
    // ... check and update ...
  } finally {
    await tx.$executeRaw`SELECT pg_advisory_unlock(hashtext(${ip}))`;
  }
});
```

**Pros:**
- Persistent state
- No additional infrastructure

**Cons:**
- Higher latency
- Database load
- Connection pool pressure

## Implementation in AgroBridge Foundation

### Architecture

```
┌─────────────────┐
│  API Request    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│   LoginRateLimiter      │
│  ┌───────────────────┐  │
│  │  checkAndRecord() │  │
│  └─────────┬─────────┘  │
│            │             │
│    ┌───────┴───────┐     │
│    ▼               ▼     │
│ ┌────────┐    ┌────────┐ │
│ │ Redis  │    │ Memory │ │
│ │  Lua   │    │ Mutex  │ │
│ └────────┘    └────────┘ │
└─────────────────────────┘
```

### Usage

```typescript
import { LoginRateLimiter } from './rate-limiting/login-rate-limiter';

// Initialize with Redis (distributed)
const limiter = new LoginRateLimiter({
  maxAttempts: 5,
  windowMs: 60000,
  blockDurationMs: 300000,
}, redisClient);

// Or in-memory only (single instance)
const limiter = new LoginRateLimiter({
  maxAttempts: 5,
  windowMs: 60000,
  blockDurationMs: 300000,
});

// In your login handler
app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.ip;
  
  // Atomic check and record
  const limitResult = await limiter.checkAndRecord(clientIp, true);
  
  if (!limitResult.allowed) {
    return res.status(429).json({
      error: 'Too many login attempts',
      retryAfter: Math.ceil(limitResult.retryAfterMs / 1000)
    });
  }
  
  // Proceed with login...
  const result = await attemptLogin(req.body);
  
  if (result.success) {
    // Reset on successful login
    await limiter.resetForIp(clientIp);
  }
  
  res.json(result);
});
```

## Metrics and Monitoring

### Key Metrics

```typescript
// Prometheus metrics
const loginRaceConditionsDetected = new Counter({
  name: 'login_rate_limit_race_conditions_total',
  help: 'Potential race conditions detected',
  labelNames: ['detection_method']
});

const loginAtomicOperationsTotal = new Counter({
  name: 'login_rate_limit_atomic_operations_total',
  help: 'Total atomic operations',
  labelNames: ['store_type', 'operation']
});

const loginRateLimitLatencyMs = new Histogram({
  name: 'login_rate_limit_latency_ms',
  help: 'Operation latency',
  labelNames: ['store_type', 'operation']
});
```

### Race Condition Detection

The implementation detects potential race conditions:

1. **Redis Fallback**: When Redis fails and falls back to in-memory
2. **Blocked Record Attempt**: When trying to record a failure while blocked

### Alerting

```yaml
# Example Prometheus alerting rule
- alert: LoginRateLimitRaceConditionDetected
  expr: login_rate_limit_race_conditions_total > 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Potential race condition in login rate limiting"
```

## Testing Concurrent Access

### Load Testing

```typescript
// Simulate 1000 concurrent requests
const promises = Array.from({ length: 1000 }, () => 
  limiter.checkAndRecord(ip, true)
);

const results = await Promise.all(promises);
const allowed = results.filter(r => r.allowed).length;

// Should never exceed maxAttempts
expect(allowed).toBe(maxAttempts);
```

### Chaos Testing

```typescript
// Random mix of operations
const operations = Array.from({ length: 100 }, (_, i) => {
  if (Math.random() > 0.5) {
    return limiter.checkAndRecord(ip, false); // Check only
  } else {
    return limiter.checkAndRecord(ip, true);  // Record failure
  }
});

await Promise.all(operations);
```

## Best Practices

### 1. Always Use Atomic Operations

```typescript
// ❌ DON'T: Separate check and record
const allowed = await limiter.checkLimit(ip);
if (allowed) {
  await limiter.recordFailedAttempt(ip); // Race condition!
}

// ✅ DO: Atomic operation
const result = await limiter.checkAndRecord(ip, true);
```

### 2. Choose the Right Store

| Deployment | Recommended Store |
|------------|-------------------|
| Single instance | In-memory with mutex |
| Multi-instance | Redis with Lua scripts |
| High persistence | Database with advisory locks |

### 3. Set Appropriate Limits

```typescript
const config = {
  maxAttempts: 5,           // 5 attempts
  windowMs: 60000,          // per minute
  blockDurationMs: 300000   // 5 minute block
};
```

### 4. Handle Failures Gracefully

```typescript
async checkAndRecord(ip: string, recordFailure: boolean): Promise<Result> {
  try {
    return await this.atomicOperation(ip, recordFailure);
  } catch (error) {
    // Log error
    logger.error('Rate limiter error', { error, ip });
    
    // Fail open - allow request rather than lock out user
    return { allowed: true, attemptsRemaining: config.maxAttempts };
  }
}
```

### 5. Cleanup Resources

```typescript
// Always clean up when done
process.on('SIGTERM', () => {
  limiter.destroy();
});
```

## Migration Guide

### From Vulnerable Pattern

```typescript
// Before (vulnerable)
class OldRateLimiter {
  checkLimit(ip: string): boolean { /* ... */ }
  recordFailedAttempt(ip: string): void { /* ... */ }
}

// Migration
class NewRateLimiter {
  // New atomic method
  async checkAndRecord(ip: string, record: boolean): Promise<Result> { /* ... */ }
  
  // Old methods deprecated but functional
  /** @deprecated Use checkAndRecord() */
  checkLimit(ip: string): Result { /* ... */ }
  
  /** @deprecated Use checkAndRecord() */
  recordFailedAttempt(ip: string): void { /* ... */ }
}
```

## References

- [OWASP Rate Limiting](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html)
- [Redis Lua Scripting](https://redis.io/docs/interact/programmability/eval-intro/)
- [async-mutex Documentation](https://www.npmjs.com/package/async-mutex)
- [TOCTOU on Wikipedia](https://en.wikipedia.org/wiki/Time-of-check_to_time-of-use)

---

*Document maintained by the AgroBridge Foundation Engineering Team*
