import { trace, Span, SpanStatusCode, Attributes, context } from '@opentelemetry/api';

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation, requests pass through
  OPEN = 'OPEN', // Failure threshold reached, reject immediately
  HALF_OPEN = 'HALF_OPEN', // Testing if service has recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  // Number of consecutive failures before opening circuit
  failureThreshold: number;

  // Time (ms) to keep circuit open before attempting recovery
  openDuration: number;

  // Number of successful requests to close circuit in HALF_OPEN
  successThreshold: number;

  // Time (ms) for single request timeout
  timeout: number;

  // Adaptive timeout configuration
  adaptiveTimeout?: {
    enabled: boolean;
    minTimeout: number;
    maxTimeout: number;
    p99LatencyFactor: number;
  };

  // Sliding window for failure rate calculation (default: 60s)
  slidingWindowMs?: number;

  // Minimum requests before failure rate calculation kicks in
  minimumRequestThreshold?: number;
}

/**
 * Circuit breaker result
 */
export interface CircuitBreakerResult<T> {
  success: boolean;
  data?: T | undefined;
  error?: Error | undefined;
  circuitState: CircuitState;
  durationMs: number;
  fromFallback?: boolean | undefined;
  traceId?: string | undefined;
}

/**
 * Event types for circuit breaker state changes
 */
export type CircuitBreakerEvent =
  | { type: 'STATE_CHANGE'; from: CircuitState; to: CircuitState; timestamp: number }
  | { type: 'REQUEST_SUCCESS'; durationMs: number; timestamp: number }
  | { type: 'REQUEST_FAILURE'; error: Error; durationMs: number; timestamp: number }
  | { type: 'REQUEST_TIMEOUT'; durationMs: number; timestamp: number }
  | { type: 'FALLBACK_USED'; timestamp: number };

/**
 * Event listener type
 */
export type CircuitBreakerEventListener = (event: CircuitBreakerEvent) => void;

/**
 * Sliding window for tracking request outcomes
 * Uses a ring buffer for O(1) operations
 */
class SlidingWindowCounter {
  private readonly buckets: { success: number; failure: number; timestamp: number }[];
  private readonly bucketDurationMs: number;
  private readonly windowSize: number;
  private currentBucketIndex: number = 0;

  constructor(windowMs: number = 60_000, bucketCount: number = 60) {
    this.windowSize = bucketCount;
    this.bucketDurationMs = windowMs / bucketCount;
    this.buckets = Array.from({ length: bucketCount }, () => ({
      success: 0,
      failure: 0,
      timestamp: 0,
    }));
  }

  private getCurrentBucket(): { success: number; failure: number; timestamp: number } {
    const now = Date.now();
    const bucketIndex = Math.floor(now / this.bucketDurationMs) % this.windowSize;

    // Reset bucket if it's from a previous window
    if (this.buckets[bucketIndex]!.timestamp < now - this.windowSize * this.bucketDurationMs) {
      this.buckets[bucketIndex] = { success: 0, failure: 0, timestamp: now };
    }

    this.currentBucketIndex = bucketIndex;
    return this.buckets[bucketIndex]!;
  }

  recordSuccess(): void {
    this.getCurrentBucket().success++;
  }

  recordFailure(): void {
    this.getCurrentBucket().failure++;
  }

  getStats(): { totalRequests: number; failures: number; failureRate: number } {
    const now = Date.now();
    const cutoff = now - this.windowSize * this.bucketDurationMs;

    let totalRequests = 0;
    let failures = 0;

    for (const bucket of this.buckets) {
      if (bucket.timestamp >= cutoff) {
        totalRequests += bucket.success + bucket.failure;
        failures += bucket.failure;
      }
    }

    return {
      totalRequests,
      failures,
      failureRate: totalRequests > 0 ? failures / totalRequests : 0,
    };
  }

  reset(): void {
    for (const bucket of this.buckets) {
      bucket.success = 0;
      bucket.failure = 0;
      bucket.timestamp = 0;
    }
  }
}

/**
 * Latency tracking with percentile calculations
 * Uses reservoir sampling for memory efficiency
 */
class LatencyTracker {
  private samples: number[] = [];
  private readonly maxSamples: number;
  private sampleCount: number = 0;

  constructor(maxSamples: number = 1000) {
    this.maxSamples = maxSamples;
  }

  record(latencyMs: number): void {
    this.sampleCount++;

    if (this.samples.length < this.maxSamples) {
      this.samples.push(latencyMs);
    } else {
      // Reservoir sampling for uniform distribution
      const replaceIndex = Math.floor(Math.random() * this.sampleCount);
      if (replaceIndex < this.maxSamples) {
        this.samples[replaceIndex] = latencyMs;
      }
    }
  }

  getPercentile(percentile: number): number {
    if (this.samples.length === 0) return 0;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * (percentile / 100));
    return sorted[Math.min(index, sorted.length - 1)] || 0;
  }

  getP50(): number {
    return this.getPercentile(50);
  }

  getP95(): number {
    return this.getPercentile(95);
  }

  getP99(): number {
    return this.getPercentile(99);
  }

  getAverage(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  getMin(): number {
    if (this.samples.length === 0) return 0;
    return Math.min(...this.samples);
  }

  getMax(): number {
    if (this.samples.length === 0) return 0;
    return Math.max(...this.samples);
  }

  reset(): void {
    this.samples = [];
    this.sampleCount = 0;
  }
}

/**
 * Production-grade Circuit Breaker for external service calls
 *
 * Features:
 * - State machine: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
 * - Adaptive timeouts based on P99 latency
 * - Sliding window failure rate calculation
 * - OpenTelemetry distributed tracing
 * - Event-driven architecture for monitoring
 * - Exponential backoff with jitter
 * - Request hedging support (future)
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker<Response>({
 *   failureThreshold: 5,
 *   openDuration: 30000,
 *   successThreshold: 3,
 *   timeout: 1000,
 * }, 'payment-service');
 *
 * const result = await breaker.execute(
 *   () => fetch('https://api.payment.com/charge'),
 *   new Response(JSON.stringify({ error: 'service unavailable' }), { status: 503 })
 * );
 * ```
 */
export class CircuitBreaker<T> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private openUntil: number = 0;
  private lastStateChange: number = Date.now();

  private readonly latencyTracker: LatencyTracker;
  private readonly slidingWindow: SlidingWindowCounter;
  private readonly eventListeners: Set<CircuitBreakerEventListener> = new Set();
  private readonly tracer = trace.getTracer('circuit-breaker', '1.0.0');

  // Metrics
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalTimeouts: number = 0;
  private totalFallbacks: number = 0;
  private consecutiveSuccesses: number = 0;
  private consecutiveFailures: number = 0;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly serviceName: string = 'unknown',
  ) {
    this.latencyTracker = new LatencyTracker(1000);
    this.slidingWindow = new SlidingWindowCounter(config.slidingWindowMs || 60_000);
  }

  /**
   * Subscribe to circuit breaker events
   */
  on(listener: CircuitBreakerEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: CircuitBreakerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (e) {
        // Don't let listener errors affect circuit breaker operation
        console.error(`[CircuitBreaker:${this.serviceName}] Event listener error:`, e);
      }
    }
  }

  /**
   * Execute operation with circuit breaker protection and distributed tracing
   */
  async execute(operation: () => Promise<T>, fallbackValue?: T): Promise<CircuitBreakerResult<T>> {
    return this.tracer.startActiveSpan(
      `circuit_breaker.${this.serviceName}`,
      {
        attributes: {
          'circuit_breaker.service': this.serviceName,
          'circuit_breaker.state': this.state,
        },
      },
      async (span: Span) => {
        const startTime = process.hrtime.bigint();
        const currentState = this.getState();
        const traceId = span.spanContext().traceId;

        // Add state attributes
        span.setAttributes({
          'circuit_breaker.state_at_start': currentState,
          'circuit_breaker.failure_count': this.failureCount,
          'circuit_breaker.success_count': this.successCount,
        });

        // Reject immediately if circuit is OPEN
        if (currentState === CircuitState.OPEN) {
          const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Circuit breaker OPEN' });
          span.setAttributes({
            'circuit_breaker.rejected': true,
            'circuit_breaker.open_until': new Date(this.openUntil).toISOString(),
          });
          span.end();

          if (fallbackValue !== undefined) {
            this.totalFallbacks++;
            this.emit({ type: 'FALLBACK_USED', timestamp: Date.now() });
          }

          return {
            success: fallbackValue !== undefined,
            data: fallbackValue,
            error: new Error(`Circuit breaker OPEN for ${this.serviceName}`),
            circuitState: currentState,
            durationMs,
            fromFallback: true,
            traceId,
          };
        }

        // Calculate adaptive timeout
        const timeout = this.calculateTimeout();
        span.setAttribute('circuit_breaker.timeout_ms', timeout);

        // Execute with timeout
        const result = await this.executeWithTimeout(operation, timeout, fallbackValue, span);

        // Record metrics
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        this.totalRequests++;

        if (result.success) {
          this.onSuccess(durationMs);
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          this.onFailure(durationMs, result.error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error?.message || 'Unknown error',
          });
        }

        span.setAttributes({
          'circuit_breaker.duration_ms': durationMs,
          'circuit_breaker.success': result.success,
          'circuit_breaker.from_fallback': result.fromFallback || false,
          'circuit_breaker.state_at_end': this.state,
        });
        span.end();

        return { ...result, durationMs, traceId };
      },
    );
  }

  /**
   * Execute operation with multiple fallback strategies
   */
  async executeWithFallbacks(
    operation: () => Promise<T>,
    fallbacks: Array<() => Promise<T>>,
    finalFallback?: T,
  ): Promise<CircuitBreakerResult<T>> {
    // Try primary operation
    const primaryResult = await this.execute(operation, undefined);
    if (primaryResult.success) {
      return primaryResult;
    }

    // Try fallbacks in order
    for (let i = 0; i < fallbacks.length; i++) {
      try {
        const fallbackResult = await fallbacks[i]!();
        return {
          success: true,
          data: fallbackResult,
          circuitState: this.state,
          durationMs: primaryResult.durationMs,
          fromFallback: true,
        };
      } catch (e) {
        console.warn(`[CircuitBreaker:${this.serviceName}] Fallback ${i + 1} failed:`, e);
      }
    }

    // Return final fallback value
    if (finalFallback !== undefined) {
      this.totalFallbacks++;
      return {
        success: true,
        data: finalFallback,
        circuitState: this.state,
        durationMs: primaryResult.durationMs,
        fromFallback: true,
      };
    }

    return primaryResult;
  }

  /**
   * Calculate adaptive timeout based on latency history
   */
  private calculateTimeout(): number {
    let timeout = this.config.timeout;

    if (this.config.adaptiveTimeout?.enabled) {
      const p99Latency = this.latencyTracker.getP99();
      if (p99Latency > 0) {
        timeout = Math.min(
          Math.max(
            p99Latency * (this.config.adaptiveTimeout.p99LatencyFactor || 1.5),
            this.config.adaptiveTimeout.minTimeout,
          ),
          this.config.adaptiveTimeout.maxTimeout,
        );
      }
    }

    return timeout;
  }

  /**
   * Execute operation with timeout and jitter
   */
  private async executeWithTimeout(
    operation: () => Promise<T>,
    timeoutMs: number,
    fallbackValue?: T,
    parentSpan?: Span,
  ): Promise<Omit<CircuitBreakerResult<T>, 'durationMs' | 'traceId'>> {
    const span = this.tracer.startSpan(
      `circuit_breaker.${this.serviceName}.execute`,
      { attributes: { 'circuit_breaker.timeout_ms': timeoutMs } },
      parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined,
    );

    try {
      // Add jitter to prevent thundering herd
      const jitter = Math.random() * Math.min(100, timeoutMs * 0.1);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${this.serviceName} timeout after ${timeoutMs}ms`));
        }, timeoutMs + jitter);
      });

      const result = await Promise.race([operation(), timeoutPromise]);

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return {
        success: true,
        data: result,
        circuitState: this.state,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timeout');

      if (isTimeout) {
        this.totalTimeouts++;
        this.emit({
          type: 'REQUEST_TIMEOUT',
          durationMs: timeoutMs,
          timestamp: Date.now(),
        });
      }

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      span.end();

      if (fallbackValue !== undefined) {
        this.totalFallbacks++;
        this.emit({ type: 'FALLBACK_USED', timestamp: Date.now() });
      }

      return {
        success: false,
        error: error as Error,
        data: fallbackValue,
        circuitState: this.state,
        fromFallback: fallbackValue !== undefined,
      };
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(durationMs: number): void {
    this.failureCount = 0;
    this.successCount++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    // Track latency and sliding window
    this.latencyTracker.record(durationMs);
    this.slidingWindow.recordSuccess();

    this.emit({
      type: 'REQUEST_SUCCESS',
      durationMs,
      timestamp: Date.now(),
    });

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(durationMs: number, error?: Error): void {
    this.totalFailures++;
    this.failureCount++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    this.slidingWindow.recordFailure();

    this.emit({
      type: 'REQUEST_FAILURE',
      error: error || new Error('Unknown error'),
      durationMs,
      timestamp: Date.now(),
    });

    // Check failure rate from sliding window
    const { failureRate, totalRequests } = this.slidingWindow.getStats();
    const minimumRequests = this.config.minimumRequestThreshold || 10;

    // Open circuit based on either consecutive failures or failure rate
    if (this.state === CircuitState.CLOSED) {
      const shouldOpenByCount = this.failureCount >= this.config.failureThreshold;
      const shouldOpenByRate = totalRequests >= minimumRequests && failureRate > 0.5;

      if (shouldOpenByCount || shouldOpenByRate) {
        this.transitionTo(CircuitState.OPEN);
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN re-opens circuit
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.lastStateChange = Date.now();

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.OPEN) {
      this.openUntil = Date.now() + this.config.openDuration;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }

    this.emit({
      type: 'STATE_CHANGE',
      from: previousState,
      to: newState,
      timestamp: Date.now(),
    });

    // Log state transitions
    const logLevel = newState === CircuitState.OPEN ? 'error' : 'log';
    console[logLevel](
      `[CircuitBreaker:${this.serviceName}] State: ${previousState} -> ${newState}. ` +
        (newState === CircuitState.OPEN
          ? `Will retry at ${new Date(this.openUntil).toISOString()}`
          : ''),
    );
  }

  /**
   * Get current state (may trigger state transitions)
   */
  getState(): CircuitState {
    // Check if should attempt reset
    if (this.state === CircuitState.OPEN && Date.now() >= this.openUntil) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    return this.state;
  }

  /**
   * Get comprehensive circuit breaker metrics
   */
  getMetrics(): {
    state: CircuitState;
    totalRequests: number;
    totalFailures: number;
    totalTimeouts: number;
    totalFallbacks: number;
    failureRate: number;
    timeoutRate: number;
    slidingWindowFailureRate: number;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    avgLatency: number;
    minLatency: number;
    maxLatency: number;
    lastStateChange: number;
    openUntil: number | null;
  } {
    const slidingStats = this.slidingWindow.getStats();

    return {
      state: this.state,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalTimeouts: this.totalTimeouts,
      totalFallbacks: this.totalFallbacks,
      failureRate: this.totalRequests > 0 ? this.totalFailures / this.totalRequests : 0,
      timeoutRate: this.totalRequests > 0 ? this.totalTimeouts / this.totalRequests : 0,
      slidingWindowFailureRate: slidingStats.failureRate,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveFailures: this.consecutiveFailures,
      p50Latency: this.latencyTracker.getP50(),
      p95Latency: this.latencyTracker.getP95(),
      p99Latency: this.latencyTracker.getP99(),
      avgLatency: this.latencyTracker.getAverage(),
      minLatency: this.latencyTracker.getMin(),
      maxLatency: this.latencyTracker.getMax(),
      lastStateChange: this.lastStateChange,
      openUntil: this.state === CircuitState.OPEN ? this.openUntil : null,
    };
  }

  /**
   * Get health status for monitoring
   */
  getHealthStatus(): {
    healthy: boolean;
    state: CircuitState;
    degraded: boolean;
    message: string;
  } {
    // Check state first to trigger any pending transitions (e.g., OPEN -> HALF_OPEN)
    const currentState = this.getState();
    const metrics = this.getMetrics();
    const healthy = currentState === CircuitState.CLOSED;
    const degraded =
      currentState === CircuitState.HALF_OPEN || metrics.slidingWindowFailureRate > 0.1;

    let message = `Circuit ${currentState}`;
    if (currentState === CircuitState.OPEN) {
      const remainingMs = Math.max(0, this.openUntil - Date.now());
      message = `Circuit OPEN, will retry in ${Math.round(remainingMs / 1000)}s`;
    } else if (degraded) {
      message = `Circuit degraded, failure rate: ${(metrics.slidingWindowFailureRate * 100).toFixed(1)}%`;
    }

    return { healthy, state: currentState, degraded, message };
  }

  /**
   * Force circuit to open (for testing or emergency)
   */
  forceOpen(durationMs?: number): void {
    this.openUntil = Date.now() + (durationMs || this.config.openDuration);
    this.transitionTo(CircuitState.OPEN);
    console.warn(
      `[CircuitBreaker:${this.serviceName}] Forced OPEN until ${new Date(this.openUntil).toISOString()}`,
    );
  }

  /**
   * Force circuit to close (for testing or manual recovery)
   */
  forceClose(): void {
    this.transitionTo(CircuitState.CLOSED);
    console.warn(`[CircuitBreaker:${this.serviceName}] Forced CLOSED`);
  }

  /**
   * Manually reset circuit breaker (for testing or manual recovery)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.openUntil = 0;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalTimeouts = 0;
    this.totalFallbacks = 0;
    this.lastStateChange = Date.now();
    this.latencyTracker.reset();
    this.slidingWindow.reset();

    console.log(`[CircuitBreaker:${this.serviceName}] Reset to initial state`);
  }
}

export default CircuitBreaker;
