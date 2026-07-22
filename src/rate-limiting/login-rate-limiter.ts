import { trace } from '@opentelemetry/api';
import { Mutex } from 'async-mutex';
import type { RedisClientType } from 'redis';
import { Counter, Histogram } from 'prom-client';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Atomic login-specific rate limiter with sliding window algorithm.
 * 
 * SECURITY FIX: This implementation fixes the TOCTOU (Time-of-Check-Time-of-Use)
 * vulnerability present in the previous version by making check-and-increment
 * operations atomic.
 * 
 * Features:
 * - Per-IP tracking with configurable window
 * - Atomic check-and-increment operations (no race conditions)
 * - Redis Lua scripts for distributed atomicity
 * - In-memory mutex fallback for single-instance deployments
 * - Automatic cleanup of expired entries
 * - OpenTelemetry instrumentation with race condition detection metrics
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
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

// Prometheus metrics for race condition detection
const loginRaceConditionsDetected = new Counter({
  name: 'login_rate_limit_race_conditions_total',
  help: 'Total number of potential race conditions detected in login rate limiting',
  labelNames: ['detection_method'] as const,
});

const loginAtomicOperationsTotal = new Counter({
  name: 'login_rate_limit_atomic_operations_total',
  help: 'Total number of atomic rate limit operations',
  labelNames: ['store_type', 'operation'] as const,
});

const loginRateLimitLatencyMs = new Histogram({
  name: 'login_rate_limit_latency_ms',
  help: 'Latency of login rate limit operations in milliseconds',
  labelNames: ['store_type', 'operation'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500],
});

// Lua script for atomic Redis operations
const REDIS_LOGIN_LIMITER_LUA = `
local key = KEYS[1]
local max_attempts = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local block_duration_ms = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local record_failure = tonumber(ARGV[5])  -- 1 to record failure, 0 to only check

-- Get current record
local record_json = redis.call('GET', key)
local record
if record_json then
  record = cjson.decode(record_json)
else
  record = { attempts = {}, blockedUntil = nil }
end

-- Check if blocked
if record.blockedUntil and now < record.blockedUntil then
  local retry_after = record.blockedUntil - now
  return { 0, 0, retry_after, #record.attempts }  -- blocked, 0 remaining, retry_after, total
end

-- Clear expired block
if record.blockedUntil and now >= record.blockedUntil then
  record.blockedUntil = nil
  record.attempts = {}
end

-- Filter attempts within window
local window_start = now - window_ms
local valid_attempts = {}
for i, ts in ipairs(record.attempts) do
  if ts > window_start then
    table.insert(valid_attempts, ts)
  end
end
record.attempts = valid_attempts

local attempts_remaining = math.max(0, max_attempts - #record.attempts)
local allowed = attempts_remaining > 0

-- Record failure if requested
if record_failure == 1 then
  table.insert(record.attempts, now)
  
  -- Check if should block
  if #record.attempts >= max_attempts then
    record.blockedUntil = now + block_duration_ms
  end
  
  -- Save record
  local ttl_ms = window_ms + block_duration_ms
  redis.call('SET', key, cjson.encode(record), 'PX', ttl_ms)
  
  attempts_remaining = math.max(0, max_attempts - #record.attempts)
  allowed = attempts_remaining > 0
end

return { allowed and 1 or 0, attempts_remaining, 0, #record.attempts }
`;

export class LoginRateLimiter {
  private readonly records = new Map<string, IpRecord>();
  private readonly locks = new Map<string, Mutex>();
  private readonly globalLock = new Mutex();
  private readonly config: LoginRateLimiterConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private redis: RedisClientType | null = null;
  private redisScriptSha: string | null = null;
  private useRedis: boolean = false;

  constructor(config: LoginRateLimiterConfig, redis?: RedisClientType) {
    this.config = config;

    if (redis) {
      this.redis = redis;
      this.useRedis = true;
      this.loadRedisScript().catch(() => {
        // Fallback to in-memory if Redis script loading fails
        this.useRedis = false;
      });
    }

    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private async loadRedisScript(): Promise<void> {
    if (!this.redis) return;
    
    try {
      this.redisScriptSha = await this.redis.scriptLoad(REDIS_LOGIN_LIMITER_LUA);
    } catch (err) {
      // If JSON command not available, we can't use this script
      throw err;
    }
  }

  /**
   * Get or create a mutex for a specific IP
   */
  private getLockForIp(ip: string): Mutex {
    let lock = this.locks.get(ip);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(ip, lock);
    }
    return lock;
  }

  /**
   * ATOMIC operation: Check if an IP is allowed and optionally record a failed attempt.
   * This method fixes the TOCTOU vulnerability by performing check and increment
   * as a single atomic operation.
   * 
   * @param ip - The IP address to check
   * @param recordFailure - If true, atomically records a failed attempt
   * @returns RateLimitResult with current status
   */
  async checkAndRecord(
    ip: string, 
    recordFailure: boolean = false
  ): Promise<RateLimitResult> {
    const tracer = trace.getTracer('agrobridge.auth');
    const startTime = Date.now();

    return tracer.startActiveSpan('login_rate_limit.atomic_check', async (span) => {
      try {
        span.setAttribute('login_rate_limit.ip', ip);
        span.setAttribute('login_rate_limit.record_failure', recordFailure);

        let result: RateLimitResult;

        if (this.useRedis && this.redis && this.redisScriptSha) {
          result = await this.checkAndRecordRedis(ip, recordFailure);
          span.setAttribute('login_rate_limit.store_type', 'redis');
          loginAtomicOperationsTotal.inc({ store_type: 'redis', operation: recordFailure ? 'check_and_record' : 'check' });
        } else {
          result = await this.checkAndRecordInMemory(ip, recordFailure);
          span.setAttribute('login_rate_limit.store_type', 'memory');
          loginAtomicOperationsTotal.inc({ store_type: 'memory', operation: recordFailure ? 'check_and_record' : 'check' });
        }

        const latency = Date.now() - startTime;
        loginRateLimitLatencyMs.observe(
          { store_type: this.useRedis ? 'redis' : 'memory', operation: recordFailure ? 'check_and_record' : 'check' },
          latency
        );

        span.setAttribute('login_rate_limit.allowed', result.allowed);
        span.setAttribute('login_rate_limit.attempts_remaining', result.attemptsRemaining);
        span.setAttribute('login_rate_limit.total_attempts', result.totalAttempts);
        span.setAttribute('login_rate_limit.latency_ms', latency);

        return result;
      } catch (err) {
        span.recordException(err as Error);
        // Fail open on error - allow the request
        return {
          allowed: true,
          attemptsRemaining: this.config.maxAttempts,
          retryAfterMs: 0,
          totalAttempts: 0,
        };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Redis-based atomic check-and-record using Lua script
   */
  private async checkAndRecordRedis(
    ip: string, 
    recordFailure: boolean
  ): Promise<RateLimitResult> {
    if (!this.redis || !this.redisScriptSha) {
      throw new Error('Redis not available');
    }

    const key = `login_limit:${ip}`;
    const now = Date.now();

    try {
      const result = await this.redis.evalSha(this.redisScriptSha, {
        keys: [key],
        arguments: [
          this.config.maxAttempts.toString(),
          this.config.windowMs.toString(),
          this.config.blockDurationMs.toString(),
          now.toString(),
          recordFailure ? '1' : '0',
        ],
      });

      if (!result || !Array.isArray(result)) {
        throw new Error('Invalid Redis response');
      }

      const [allowed, attemptsRemaining, retryAfterMs, totalAttempts] = result as [number, number, number, number];

      return {
        allowed: allowed === 1,
        attemptsRemaining,
        retryAfterMs,
        totalAttempts,
      };
    } catch (err) {
      // Fall back to in-memory on Redis error
      loginRaceConditionsDetected.inc({ detection_method: 'redis_fallback' });
      return this.checkAndRecordInMemory(ip, recordFailure);
    }
  }

  /**
   * In-memory atomic check-and-record using mutex locking
   */
  private async checkAndRecordInMemory(
    ip: string, 
    recordFailure: boolean
  ): Promise<RateLimitResult> {
    const lock = this.getLockForIp(ip);

    return lock.runExclusive(() => {
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
        
        // Detect potential race condition: if blocked but still recording failure
        if (recordFailure) {
          loginRaceConditionsDetected.inc({ detection_method: 'blocked_record_attempt' });
        }

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

      let attemptsRemaining = Math.max(0, this.config.maxAttempts - record.attempts.length);
      let allowed = attemptsRemaining > 0;

      // Record failure atomically with the check
      if (recordFailure) {
        record.attempts.push(now);

        // Check if should be blocked
        if (record.attempts.length >= this.config.maxAttempts) {
          record.blockedUntil = now + this.config.blockDurationMs;
        }

        // Recalculate after recording
        attemptsRemaining = Math.max(0, this.config.maxAttempts - record.attempts.length);
        allowed = attemptsRemaining > 0;
      }

      return {
        allowed,
        attemptsRemaining,
        retryAfterMs: allowed ? 0 : this.config.blockDurationMs,
        totalAttempts: record.attempts.length,
      };
    });
  }

  /**
   * DEPRECATED: Use checkAndRecord() for atomic operations.
   * 
   * This method is kept for backward compatibility but should not be used
   * in new code as it has TOCTOU vulnerabilities.
   * 
   * @deprecated Use checkAndRecord(ip, false) instead
   */
  checkLimit(ip: string): RateLimitResult {
    // Log deprecation warning in non-production
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[DEPRECATED] LoginRateLimiter.checkLimit() is deprecated. ' +
        'Use checkAndRecord() for atomic operations to prevent TOCTOU vulnerabilities.'
      );
    }

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
          span.setAttribute('login_rate_limit.deprecated_method', true);
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
        span.setAttribute('login_rate_limit.deprecated_method', true);
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
   * DEPRECATED: Use checkAndRecord(ip, true) for atomic operations.
   * 
   * This method is kept for backward compatibility but should not be used
   * in new code as it has TOCTOU vulnerabilities when used with checkLimit().
   * 
   * @deprecated Use checkAndRecord(ip, true) instead
   */
  recordFailedAttempt(ip: string): void {
    // Log deprecation warning in non-production
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[DEPRECATED] LoginRateLimiter.recordFailedAttempt() is deprecated. ' +
        'Use checkAndRecord() for atomic operations to prevent TOCTOU vulnerabilities.'
      );
    }

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
      span.setAttribute('login_rate_limit.deprecated_method', true);
      span.end();
    });
  }

  /**
   * Reset rate limit for an IP (e.g., after successful login).
   * This operation is atomic.
   */
  async resetForIp(ip: string): Promise<void> {
    if (this.useRedis && this.redis) {
      const key = `login_limit:${ip}`;
      try {
        await this.redis.del(key);
      } catch {
        // Fall back to in-memory
      }
    }

    const lock = this.getLockForIp(ip);
    await lock.runExclusive(() => {
      this.records.delete(ip);
    });
  }

  /**
   * Clean up expired records to prevent memory leaks.
   * This is called periodically and cleans up both records and locks.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    this.globalLock.runExclusive(() => {
      for (const [ip, record] of this.records.entries()) {
        // Remove if blocked period expired and no recent attempts
        const hasRecentAttempts = record.attempts.some((ts) => ts > windowStart);
        const isBlocked = record.blockedUntil && now < record.blockedUntil;

        if (!hasRecentAttempts && !isBlocked) {
          this.records.delete(ip);
          // Also clean up the lock for this IP
          this.locks.delete(ip);
        }
      }
    }).catch(() => {
      // Ignore cleanup errors
    });
  }

  /**
   * Get current stats for monitoring.
   * Note: This provides approximate stats for in-memory store.
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
   * Get race condition detection metrics
   */
  getRaceConditionMetrics(): {
    totalDetected: number;
    detectionMethods: Record<string, number>;
  } {
    // This would typically read from the metrics registry
    // For now, return a placeholder that can be enhanced with actual metrics
    return {
      totalDetected: 0,
      detectionMethods: {
        redis_fallback: 0,
        blocked_record_attempt: 0,
      },
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
    this.locks.clear();
    
    // Note: We don't close Redis here as it may be shared
    this.redis = null;
    this.useRedis = false;
  }
}
