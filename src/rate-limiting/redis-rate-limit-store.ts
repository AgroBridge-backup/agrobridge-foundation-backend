import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { RedisClientType } from 'redis';
import { RateLimitStore, RateLimitEntry, RateLimitResult } from './rate-limit-store.js';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store.js';
import { requestContext } from '../observability/request-context.js';
import * as metrics from '../observability/metrics/rate-limiting-metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LUA_SCRIPT = readFileSync(join(__dirname, 'rate-limit-lua.lua'), 'utf-8');

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date;
  cooldownUntil: Date | null;
  halfOpenRequests: number;
}

interface CircuitBreakerConfig {
  threshold: number;
  cooldownMs: number;
  halfOpenMaxAttempts: number;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: RedisClientType;
  private readonly fallback: InMemoryRateLimitStore;
  private readonly logger: ReturnType<typeof requestContext.getLog>;
  private fallbackUsed: boolean = false;
  private circuitBreaker: CircuitBreakerState;
  private readonly circuitBreakerConfig: CircuitBreakerConfig;
  private readonly maxRetries: number = 2;
  private readonly baseRetryDelay: number = 50;
  private readonly availabilityZone: string;

  constructor(redis: RedisClientType, fallback: InMemoryRateLimitStore) {
    this.redis = redis;
    this.fallback = fallback;
    this.logger = requestContext.getLog();

    // Track availability by zone (low cardinality)
    this.availabilityZone = process.env.AWS_ZONE || process.env.AVAILABILITY_ZONE || 'unknown';
    metrics.rateLimitRedisUnavailable.set(
      { zone: this.availabilityZone },
      0, // Initially available
    );

    this.circuitBreakerConfig = {
      threshold: 5,
      cooldownMs: 60_000,
      halfOpenMaxAttempts: 1,
    };

    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: new Date(),
      cooldownUntil: null,
      halfOpenRequests: 0,
    };
  }

  private getRedisKey(identifier: string): string {
    return `ratelimit:${identifier}`;
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const retryablePatterns = [
        'ETIMEDOUT',
        'ECONNRESET',
        'EPIPE',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'Connection lost',
        'READONLY',
        'LOADING',
        'MASTERDOWN',
        'NOREPLICAS',
      ];
      const message = err.message;
      return retryablePatterns.some((pattern) => message.includes(pattern));
    }
    return false;
  }

  async get(identifier: string): Promise<RateLimitEntry | null> {
    if (this.shouldUseFallback()) {
      return this.fallback.get(identifier);
    }

    try {
      const key = this.getRedisKey(identifier);
      const hash = await this.redis.hGetAll(key);

      if (!hash || Object.keys(hash).length === 0) {
        return null;
      }

      return {
        count: parseInt(hash.count || '0', 10),
        resetTime: new Date(parseInt(hash.resetTime || '0', 10)),
      };
    } catch (err) {
      this.updateCircuitBreaker(false);
      return this.fallback.get(identifier);
    }
  }

  async incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult> {
    if (this.shouldUseFallback()) {
      return this.fallback.incrementWithLimit(identifier, maxRequests, timeWindowMs);
    }

    return this.incrementWithRetry(identifier, maxRequests, timeWindowMs);
  }

  private async incrementWithRetry(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (this.shouldUseFallback()) {
        this.fallbackUsed = true;
        return this.fallback.incrementWithLimit(identifier, maxRequests, timeWindowMs);
      }

      try {
        const key = this.getRedisKey(identifier);
        const result = await this.redis.eval(LUA_SCRIPT, {
          keys: [key],
          arguments: [maxRequests.toString(), timeWindowMs.toString(), Date.now().toString()],
        });

        if (!result || !Array.isArray(result)) {
          throw new Error('Invalid Redis response');
        }

        const [allowed, count, limit, resetTime] = result as [number, number, number, number];

        this.updateCircuitBreaker(true);
        return {
          count,
          allowed: allowed === 1,
          resetTime: new Date(resetTime),
        };
      } catch (err) {
        const isRetryable = this.isRetryableError(err);
        const shouldOpenCircuit = !isRetryable || attempt === this.maxRetries - 1;

        if (shouldOpenCircuit) {
          this.updateCircuitBreaker(false);
        }

        if (attempt === this.maxRetries - 1 || !isRetryable) {
          this.fallbackUsed = true;
          return this.fallback.incrementWithLimit(identifier, maxRequests, timeWindowMs);
        }

        const delay = this.baseRetryDelay * Math.pow(2, attempt) + Math.random() * 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.fallbackUsed = true;
    return this.fallback.incrementWithLimit(identifier, maxRequests, timeWindowMs);
  }

  async delete(identifier: string): Promise<void> {
    if (this.shouldUseFallback()) {
      return this.fallback.delete(identifier);
    }

    try {
      const key = this.getRedisKey(identifier);
      await this.redis.del(key);
    } catch (err) {
      this.updateCircuitBreaker(false);
      return this.fallback.delete(identifier);
    }
  }

  async cleanup(): Promise<void> {
    await this.fallback.cleanup();
  }

  private updateCircuitBreaker(success: boolean): void {
    if (success) {
      if (this.circuitBreaker.halfOpenRequests > 0) {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.halfOpenRequests = 0;
        this.circuitBreaker.cooldownUntil = null;
        this.logger?.info(
          { circuitBreaker: 'closed' },
          'Circuit breaker closed after successful half-open request',
        );
      }
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.cooldownUntil = null;

      // Redis is available
      metrics.rateLimitRedisUnavailable.set({ zone: this.availabilityZone }, 0);
    } else {
      this.circuitBreaker.failureCount++;
      this.circuitBreaker.lastFailureTime = new Date();
      this.circuitBreaker.halfOpenRequests = 0;
      if (this.circuitBreaker.failureCount >= this.circuitBreakerConfig.threshold) {
        this.circuitBreaker.isOpen = true;
        this.circuitBreaker.cooldownUntil = new Date(
          Date.now() + this.circuitBreakerConfig.cooldownMs,
        );
        this.logger?.error(
          {
            failureCount: this.circuitBreaker.failureCount,
            cooldownUntil: this.circuitBreaker.cooldownUntil,
            threshold: this.circuitBreakerConfig.threshold,
          },
          'Circuit breaker opened due to consecutive failures',
        );

        // Redis is unavailable
        metrics.rateLimitRedisUnavailable.set({ zone: this.availabilityZone }, 1);
      }
    }
  }

  private shouldUseFallback(): boolean {
    if (this.circuitBreaker.isOpen) {
      if (this.circuitBreaker.cooldownUntil) {
        const now = Date.now();
        if (now >= this.circuitBreaker.cooldownUntil.getTime()) {
          if (
            this.circuitBreaker.halfOpenRequests < this.circuitBreakerConfig.halfOpenMaxAttempts
          ) {
            this.circuitBreaker.halfOpenRequests++;
            return false;
          }
        }
        return true;
      }
      return false;
    }
    return false;
  }

  didFallback(): boolean {
    const result = this.fallbackUsed;
    this.fallbackUsed = false;
    return result;
  }

  isCircuitBreakerOpen(): boolean {
    return this.circuitBreaker.isOpen;
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }
}
