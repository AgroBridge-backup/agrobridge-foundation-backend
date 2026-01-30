import { trace } from '@opentelemetry/api';

/**
 * Login-specific rate limiter with sliding window algorithm.
 * Provides stricter rate limiting for authentication endpoints.
 *
 * Features:
 * - Per-IP tracking with configurable window
 * - Automatic cleanup of expired entries
 * - OpenTelemetry instrumentation
 * - Thread-safe (single-threaded Node.js)
 */

export interface LoginRateLimiterConfig {
  /** Maximum login attempts allowed within the window */
  maxAttempts: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Duration to block after exceeding limit */
  blockDurationMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  attemptsRemaining: number;
  retryAfterMs: number;
  totalAttempts: number;
}

interface IpRecord {
  attempts: number[];
  blockedUntil: number | null;
}

export class LoginRateLimiter {
  private readonly records = new Map<string, IpRecord>();
  private readonly config: LoginRateLimiterConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: LoginRateLimiterConfig) {
    this.config = config;

    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Check if an IP is allowed to attempt login
   */
  checkLimit(ip: string): RateLimitResult {
    const tracer = trace.getTracer('agrobridge.auth');

    return tracer.startActiveSpan('login_rate_limit.check', (span) => {
      try {
        const now = Date.now();
        let record = this.records.get(ip);

        // Initialize record if not exists
        if (!record) {
          record = { attempts: [], blockedUntil: null };
          this.records.set(ip, record);
        }

        // Check if currently blocked
        if (record.blockedUntil && now < record.blockedUntil) {
          const retryAfterMs = record.blockedUntil - now;
          span.setAttribute('login_rate_limit.blocked', true);
          span.setAttribute('login_rate_limit.retry_after_ms', retryAfterMs);
          span.end();

          return {
            allowed: false,
            attemptsRemaining: 0,
            retryAfterMs,
            totalAttempts: record.attempts.length,
          };
        }

        // Clear block if expired
        if (record.blockedUntil && now >= record.blockedUntil) {
          record.blockedUntil = null;
          record.attempts = [];
        }

        // Filter attempts within the window
        const windowStart = now - this.config.windowMs;
        record.attempts = record.attempts.filter((ts) => ts > windowStart);

        const attemptsRemaining = Math.max(0, this.config.maxAttempts - record.attempts.length);
        const allowed = attemptsRemaining > 0;

        span.setAttribute('login_rate_limit.allowed', allowed);
        span.setAttribute('login_rate_limit.attempts_remaining', attemptsRemaining);
        span.setAttribute('login_rate_limit.total_attempts', record.attempts.length);
        span.end();

        return {
          allowed,
          attemptsRemaining,
          retryAfterMs: allowed ? 0 : this.config.blockDurationMs,
          totalAttempts: record.attempts.length,
        };
      } catch (err) {
        span.recordException(err as Error);
        span.end();
        // Fail open on error - allow the request
        return {
          allowed: true,
          attemptsRemaining: this.config.maxAttempts,
          retryAfterMs: 0,
          totalAttempts: 0,
        };
      }
    });
  }

  /**
   * Record a failed login attempt for an IP
   */
  recordFailedAttempt(ip: string): void {
    const tracer = trace.getTracer('agrobridge.auth');

    tracer.startActiveSpan('login_rate_limit.record_failure', (span) => {
      const now = Date.now();
      let record = this.records.get(ip);

      if (!record) {
        record = { attempts: [], blockedUntil: null };
        this.records.set(ip, record);
      }

      // Add this attempt
      record.attempts.push(now);

      // Filter to keep only attempts within window
      const windowStart = now - this.config.windowMs;
      record.attempts = record.attempts.filter((ts) => ts > windowStart);

      // Check if should be blocked
      if (record.attempts.length >= this.config.maxAttempts) {
        record.blockedUntil = now + this.config.blockDurationMs;
        span.setAttribute('login_rate_limit.blocked', true);
        span.setAttribute('login_rate_limit.blocked_until', record.blockedUntil);
      }

      span.setAttribute('login_rate_limit.ip', ip);
      span.setAttribute('login_rate_limit.total_attempts', record.attempts.length);
      span.end();
    });
  }

  /**
   * Reset rate limit for an IP (e.g., after successful login)
   */
  resetForIp(ip: string): void {
    this.records.delete(ip);
  }

  /**
   * Clean up expired records to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [ip, record] of this.records.entries()) {
      // Remove if blocked period expired and no recent attempts
      const hasRecentAttempts = record.attempts.some((ts) => ts > windowStart);
      const isBlocked = record.blockedUntil && now < record.blockedUntil;

      if (!hasRecentAttempts && !isBlocked) {
        this.records.delete(ip);
      }
    }
  }

  /**
   * Get current stats for monitoring
   */
  getStats(): {
    totalTrackedIps: number;
    currentlyBlockedIps: number;
  } {
    const now = Date.now();
    let blockedCount = 0;

    for (const record of this.records.values()) {
      if (record.blockedUntil && now < record.blockedUntil) {
        blockedCount++;
      }
    }

    return {
      totalTrackedIps: this.records.size,
      currentlyBlockedIps: blockedCount,
    };
  }

  /**
   * Destroy the rate limiter and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.records.clear();
  }
}
