/**
 * Error Metrics Collection for AgroBridge Foundation
 * 
 * Prometheus metrics for error observability with proper dimensions
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { Counter, Histogram, Gauge, register } from 'prom-client';
import type { ErrorCategory, ErrorSeverity, TaxonomyErrorCode } from '../errors/error-taxonomy.js';

/**
 * Total error count by category, code, and severity
 */
export const errorRateTotal = new Counter({
  name: 'error_rate_total',
  help: 'Total number of errors by category, code, and severity',
  labelNames: ['category', 'code', 'severity', 'endpoint'] as const,
});

/**
 * Error latency histogram by category
 * Tracks how long errors take to process/return
 */
export const errorLatencySeconds = new Histogram({
  name: 'error_latency_seconds',
  help: 'Latency of error responses in seconds by category',
  labelNames: ['category', 'code'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * User impact tracking by category and endpoint
 * Counts unique users affected by errors
 */
export const errorUserImpact = new Counter({
  name: 'error_user_impact_total',
  help: 'Number of users impacted by errors (by category and endpoint)',
  labelNames: ['category', 'endpoint', 'user_type'] as const,
});

/**
 * Active error rate gauge (errors per minute)
 * For real-time alerting
 */
export const errorRatePerMinute = new Gauge({
  name: 'error_rate_per_minute',
  help: 'Current error rate per minute by category',
  labelNames: ['category', 'severity'] as const,
});

/**
 * Error classification duration
 * Time spent classifying errors
 */
export const errorClassificationDuration = new Histogram({
  name: 'error_classification_duration_seconds',
  help: 'Time spent classifying errors',
  labelNames: ['classification_method'] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01],
});

/**
 * Circuit breaker state changes triggered by errors
 */
export const errorTriggeredCircuitBreaker = new Counter({
  name: 'error_triggered_circuit_breaker_total',
  help: 'Number of times errors triggered circuit breaker',
  labelNames: ['category', 'service'] as const,
});

/**
 * Retry attempts by error category
 */
export const errorRetryAttempts = new Counter({
  name: 'error_retry_attempts_total',
  help: 'Total retry attempts by error category',
  labelNames: ['category', 'attempt_number'] as const,
});

/**
 * Error budget consumption
 * Tracks SLO error budget burn rate
 */
export const errorBudgetConsumed = new Counter({
  name: 'error_budget_consumed_total',
  help: 'Error budget consumed (for SLO tracking)',
  labelNames: ['service', 'slo_name'] as const,
});

/**
 * Infrastructure error correlation
 * Links infrastructure errors to affected endpoints
 */
export const infrastructureErrorCorrelation = new Counter({
  name: 'infrastructure_error_correlation_total',
  help: 'Correlation between infrastructure errors and affected endpoints',
  labelNames: ['infra_component', 'endpoint', 'error_code'] as const,
});

/**
 * Security event tracking
 * Separate metric for security-related errors
 */
export const securityEventTotal = new Counter({
  name: 'security_event_total',
  help: 'Security-related events by type',
  labelNames: ['event_type', 'severity', 'source_ip'] as const,
});

// Internal tracking for rate calculations
const errorTimestamps: Map<string, number[]> = new Map();
const RATE_WINDOW_MS = 60000; // 1 minute window

/**
 * Normalize an endpoint label before it reaches a metric.
 *
 * Belt-and-suspenders guard against unbounded cardinality / PII leakage: even
 * if a caller passes a raw URL, strip the query string and cap the length so the
 * label set stays small. Callers should still prefer route templates.
 */
function sanitizeEndpoint(endpoint: string): string {
  const queryIndex = endpoint.indexOf('?');
  const path = queryIndex >= 0 ? endpoint.slice(0, queryIndex) : endpoint;
  return path.length > 200 ? path.slice(0, 200) : path;
}

/**
 * Record an error with full dimensions
 */
export function recordError(opts: {
  category: ErrorCategory;
  code: TaxonomyErrorCode;
  severity: ErrorSeverity;
  endpoint: string;
  userId: string | undefined;
  userType: 'anonymous' | 'authenticated' | 'admin';
  latencyMs: number | undefined;
}): void {
  const { category, code, severity, userId, userType = 'anonymous', latencyMs } = opts;
  const endpoint = sanitizeEndpoint(opts.endpoint);

  // Increment total error counter
  errorRateTotal.inc({ category, code, severity, endpoint });

  // Record latency if provided
  if (latencyMs !== undefined) {
    errorLatencySeconds.observe({ category, code }, latencyMs / 1000);
  }

  // Track user impact
  if (userId) {
    errorUserImpact.inc({ category, endpoint, user_type: userType });
  }

  // Update rate tracking
  updateErrorRate(category, severity);

  // Track security events separately
  if (category === 'SECURITY') {
    securityEventTotal.inc({ 
      event_type: code, 
      severity, 
      source_ip: 'unknown' // Should be populated from request
    });
  }
}

/**
 * Update the error rate gauge for real-time alerting
 */
function updateErrorRate(category: ErrorCategory, severity: ErrorSeverity): void {
  const key = `${category}_${severity}`;
  const now = Date.now();

  const existingTimestamps = errorTimestamps.get(key);
  let timestamps: number[];
  if (existingTimestamps) {
    timestamps = existingTimestamps;
  } else {
    timestamps = [];
    errorTimestamps.set(key, timestamps);
  }
  timestamps.push(now);

  // Clean old timestamps outside the window
  const cutoff = now - RATE_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }

  // Update gauge with errors per minute
  errorRatePerMinute.set({ category, severity }, timestamps.length);
}

/**
 * Record retry attempt
 */
export function recordRetryAttempt(category: ErrorCategory, attemptNumber: number): void {
  errorRetryAttempts.inc({ 
    category, 
    attempt_number: attemptNumber.toString() 
  });
}

/**
 * Record circuit breaker trigger
 */
export function recordCircuitBreakerTrigger(category: ErrorCategory, service: string): void {
  errorTriggeredCircuitBreaker.inc({ category, service });
}

/**
 * Record infrastructure error correlation
 */
export function recordInfrastructureError(
  component: string,
  endpoint: string,
  code: TaxonomyErrorCode
): void {
  infrastructureErrorCorrelation.inc({ 
    infra_component: component, 
    endpoint, 
    error_code: code 
  });
}

/**
 * Consume error budget for SLO tracking
 */
export function consumeErrorBudget(service: string, sloName: string, amount: number = 1): void {
  errorBudgetConsumed.inc({ service, slo_name: sloName }, amount);
}

/**
 * Start a classification timer
 * Returns a function to stop the timer
 */
export function startClassificationTimer(method: string): () => void {
  const end = errorClassificationDuration.startTimer({ classification_method: method });
  return end;
}

/**
 * Get current error rate for a category
 */
export function getCurrentErrorRate(category: ErrorCategory, severity: ErrorSeverity): number {
  const key = `${category}_${severity}`;
  const timestamps = errorTimestamps.get(key) || [];
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  
  // Count timestamps within the window
  return timestamps.filter((ts) => ts >= cutoff).length;
}

/**
 * Reset all error metrics (useful for testing)
 */
export function resetErrorMetrics(): void {
  errorRateTotal.reset();
  errorLatencySeconds.reset();
  errorUserImpact.reset();
  errorRatePerMinute.reset();
  errorClassificationDuration.reset();
  errorTriggeredCircuitBreaker.reset();
  errorRetryAttempts.reset();
  errorBudgetConsumed.reset();
  infrastructureErrorCorrelation.reset();
  securityEventTotal.reset();
  errorTimestamps.clear();
}

/**
 * Get metrics registry for Prometheus scraping
 */
export function getErrorMetricsRegistry(): typeof register {
  return register;
}
