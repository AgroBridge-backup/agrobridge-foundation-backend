import { Counter, Histogram, Gauge } from 'prom-client';

export const rateLimitChecksTotal = new Counter({
  name: 'rate_limit_checks_total',
  help: 'Total number of rate limit checks',
  labelNames: ['tier', 'allowed', 'store_type'] as const,
});

export const rateLimitLatency = new Histogram({
  name: 'rate_limit_check_duration_seconds',
  help: 'Rate limit check duration in seconds',
  labelNames: ['tier', 'store_type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const rateLimitFallbacksTotal = new Counter({
  name: 'rate_limit_fallbacks_total',
  help: 'Total number of fallback activations',
  labelNames: ['reason'] as const,
});

export const rateLimitErrorsTotal = new Counter({
  name: 'rate_limit_errors_total',
  help: 'Total number of rate limit errors',
  labelNames: ['tier', 'error_type'] as const,
});

export const rateLimitRedisUnavailable = new Gauge({
  name: 'rate_limit_redis_unavailable',
  help: 'Whether Redis is currently unavailable for rate limiting (1 = unavailable, 0 = available)',
  labelNames: ['zone'] as const, // Changed from instance to zone (low cardinality)
});

// Abuse detector metrics
export const abuseDetectorCleanupDurationMs = new Histogram({
  name: 'abuse_detector_cleanup_duration_ms',
  help: 'Duration of abuse detector cache cleanup in milliseconds',
  labelNames: ['operation'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
});

// Circuit breaker metrics
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Current state of circuit breaker (0=OPEN, 1=HALF_OPEN, 2=CLOSED)',
  labelNames: ['service'] as const,
});

export const circuitBreakerFailureRate = new Gauge({
  name: 'circuit_breaker_failure_rate',
  help: 'Failure rate of circuit breaker',
  labelNames: ['service'] as const,
});

export const circuitBreakerP99LatencyMs = new Gauge({
  name: 'circuit_breaker_p99_latency_ms',
  help: 'P99 latency of circuit breaker in milliseconds',
  labelNames: ['service'] as const,
});
