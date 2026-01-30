# Rate Limiting Architecture

## Overview

Distributed rate limiting using Redis with in-memory fallback for high availability. The system supports multiple rate limit tiers and ensures consistent rate limiting across multiple application instances.

## Components

### RateLimitStore Interface

Abstract interface defining the contract for rate limit storage implementations. This follows the Dependency Inversion Principle, allowing the system to switch between different storage backends without changing business logic.

**Location**: `src/rate-limiting/rate-limit-store.ts`

```typescript
interface RateLimitStore {
  get(identifier: string): Promise<RateLimitEntry | null>;
  incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult>;
  delete(identifier: string): Promise<void>;
  cleanup(): void | Promise<void>;
}
```

### RedisRateLimitStore

Redis-backed implementation of `RateLimitStore` that provides:

- Horizontal scalability across multiple instances
- Atomic operations using Lua scripts
- Circuit breaker pattern for fault tolerance
- Automatic fallback to in-memory storage
- Exponential backoff for retries

**Location**: `src/rate-limiting/redis-rate-limit-store.ts`

#### Key Features

1. **Atomic Operations**: Uses Lua scripts to prevent race conditions
2. **Circuit Breaker**: Opens after 5 consecutive failures, closes after 1-minute cooldown
3. **Connection Pooling**: Max 10 connections per instance with 30-second timeout
4. **Fail-Open Strategy**: Allows requests when Redis is unavailable
5. **Automatic TTL**: Redis expires old entries automatically

#### Redis Key Strategy

- **Key format**: `ratelimit:{identifier}:{tier}`
- **Data structure**: Hash with fields: `count`, `resetTime`
- **TTL**: Set to `ceil(timeWindowMs / 1000)` seconds

### InMemoryRateLimitStore

Fallback implementation using an in-memory Map. Used when Redis is unavailable or for single-instance deployments.

**Location**: `src/rate-limiting/in-memory-rate-limit-store.ts`

#### Key Features

1. **Thread-safe**: Map operations are atomic in JS event loop
2. **Automatic cleanup**: Removes expired entries on demand
3. **O(1) operations**: Constant time get/increment
4. **No memory leaks**: Proper cleanup prevents memory issues

### TieredRateLimiter

Main rate limiting service that integrates with the store interface and provides:

- Multiple rate limit tiers (PUBLIC, AUTHENTICATED, ADMIN, etc.)
- OpenTelemetry tracing for observability
- Prometheus metrics for monitoring
- IP-based blocking and allowlisting
- Request-level rate limiting with Fastify middleware

**Location**: `src/rate-limiting/tiered-rate-limiter.ts`

### Lua Script

Atomic Redis script that performs rate limit checks and increments in a single operation, preventing race conditions.

**Location**: `src/rate-limiting/rate-limit-lua.lua`

## Design Decisions

### 1. Redis for Horizontal Scaling

**Decision**: Use Redis as the primary storage backend

**Rationale**:

- Shared state across multiple application instances
- Prevents rate limit bypass by hitting different instances
- Supports horizontal scaling without coordination
- Built-in expiration and TTL support

**Trade-off**: Adds external dependency, requires Redis maintenance

### 2. Lua Script for Atomicity

**Decision**: Use Redis EVAL with Lua scripts for atomic operations

**Rationale**:

- Prevents race conditions across concurrent requests
- Ensures check-and-increment happens atomically
- Reduces network round trips
- Consistent behavior across all instances

**Trade-off**: More complex than simple Redis commands

### 3. Fail-Open Strategy

**Decision**: Allow requests when Redis is unavailable

**Rationale**:

- Availability over consistency for rate limiting
- Prevents cascading failures
- Better user experience during outages
- Rate limiting is a best-effort service

**Trade-off**: Potential for abuse during Redis outages

### 4. Circuit Breaker Pattern

**Decision**: Implement circuit breaker to prevent cascading failures

**Rationale**:

- Prevents overwhelming Redis during outages
- Reduces latency by falling back quickly
- Allows system to recover gracefully
- Provides observability into failure modes

**Trade-off**: Adds complexity, requires threshold tuning

### 5. Connection Pooling

**Decision**: Use connection pooling with max 10 connections

**Rationale**:

- Reduces connection overhead
- Limits resource usage
- Prevents connection exhaustion
- Improves performance under load

**Trade-off**: Requires pool size tuning

### 6. Automatic TTL

**Decision**: Use Redis TTL for automatic expiration

**Rationale**:

- No manual cleanup required
- Reduces memory usage
- Simplifies implementation
- Consistent with time window semantics

**Trade-off**: Cannot easily query all active rate limit entries

## Configuration

### Environment Variables

```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Optional: OpenTelemetry collector
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

### Circuit Breaker Settings

Located in `RedisRateLimitStore` constructor:

```typescript
circuitBreakerThreshold: 5,        // Open after 5 failures
circuitBreakerCooldown: 60_000,    // 1 minute cooldown
```

### Connection Pool Settings

```typescript
maxPoolSize: 10,                   // Max 10 connections
connectionTimeout: 30_000,         // 30 second timeout
```

### Retry Settings

```typescript
maxRetries: 2,                     // Max 2 retry attempts
baseDelay: 50,                     // 50ms base delay for exponential backoff
```

## Rate Limit Tiers

| Tier      | Max Requests | Time Window | Use Case               |
| --------- | ------------ | ----------- | ---------------------- |
| PUBLIC    | 300          | 1 minute    | Unauthenticated users  |
| ADMIN     | 100          | 1 minute    | Admin dashboard        |
| WEBHOOK   | 500          | 1 minute    | Stripe webhooks        |
| STRICT    | 20           | 1 minute    | Login endpoints        |
| ABUSE     | 5            | 1 minute    | Rate-limited IPs       |
| VIP_ADMIN | 500          | 1 minute    | VIP admin users        |
| API_KEY   | 1000         | 1 minute    | API key authentication |
| DDOS      | 10           | 1 minute    | DDoS protection        |

## Monitoring

### Prometheus Metrics

#### rate_limit_checks_total

Total number of rate limit checks

Labels:

- `tier`: Rate limit tier
- `allowed`: Whether the request was allowed ("true"/"false")
- `store_type`: Storage backend used ("redis" or "in_memory")

#### rate_limit_check_duration_seconds

Histogram of rate limit check duration in seconds

Labels:

- `tier`: Rate limit tier
- `store_type`: Storage backend used

Buckets: 1ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s

#### rate_limit_fallbacks_total

Total number of fallback activations

Labels:

- `reason`: Reason for fallback ("redis_error")

### OpenTelemetry Spans

All rate limit checks create OpenTelemetry spans with attributes:

- `rate_limit.tier`: Rate limit tier
- `rate_limit.identifier`: Request identifier
- `rate_limit.allowed`: Whether the request was allowed
- `rate_limit.limit`: Maximum allowed requests
- `rate_limit.remaining`: Remaining requests
- `rate_limit.count`: Current count
- `rate_limit.store_type`: Storage backend used

### Logging

Structured logging at multiple levels:

- **debug**: Successful rate limit checks
- **warn**: Rate limit exceeded
- **error**: Redis failures, circuit breaker events

## Performance Targets

- **P99 Latency**: < 5ms for Redis, < 1ms for in-memory fallback
- **Throughput**: > 10,000 checks/second per instance
- **Memory Usage**: < 10MB for 100,000 active users

## Error Handling Hierarchy

1. **Try Redis operation**
2. **On failure**: Log warning + use in-memory fallback
3. **Circuit breaker**: After 5 failures, open for 1 minute
4. **Retry with exponential backoff**: Max 2 attempts
5. **Always fail-open**: Allow requests even on complete Redis failure

## Testing

### Unit Tests

- InMemoryRateLimitStore: Full coverage of all methods
- RedisRateLimitStore: Mocked Redis client, circuit breaker tests
- TieredRateLimiter: Store integration, OpenTelemetry verification

**Location**: `tests/unit/rate-limiting/`

### Integration Tests

- Horizontal scaling across multiple instances
- Redis failure handling and recovery
- Performance benchmarks (P99 latency, throughput)
- Memory usage under load

**Location**: `tests/integration/rate-limiting/`

### Performance Benchmarks

- Latency benchmarks (P99 measurement)
- Throughput benchmarks (operations/second)
- Memory usage benchmarks

**Location**: `tests/benchmarks/rate-limiting.bench.ts`

## Security Considerations

1. **Rate Limit Bypass Prevention**: Atomic Redis operations prevent race conditions
2. **Fail-Open Strategy**: Documented security consideration - requests are allowed during Redis outages
3. **Redis Authentication**: If required, configure in `REDIS_URL`
4. **Input Validation**: All parameters validated before use
5. **No Sensitive Data**: Redis keys contain only identifiers and tiers
6. **DDoS Protection**: Circuit breaker prevents cascading failures

## Future Enhancements

1. **Distributed Cache**: Consider using Redis Cluster for very high traffic
2. **Sliding Window**: Implement sliding window algorithm for more accurate limiting
3. **Adaptive Limits**: Adjust limits based on system load
4. **Multi-Region**: Support multi-region rate limiting
5. **Granular Metrics**: Add more detailed metrics for monitoring
6. **Dynamic Configuration**: Allow runtime configuration updates

## References

- [Redis Lua Scripting](https://redis.io/docs/manual/programmability/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Rate Limiting Algorithms](https://konghq.com/blog/how-to-design-a-scalable-rate-limiting-algorithm)
- [OpenTelemetry Tracing](https://opentelemetry.io/docs/reference/specification/trace/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
