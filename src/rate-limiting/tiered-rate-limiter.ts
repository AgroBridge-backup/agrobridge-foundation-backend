import { FastifyRequest, FastifyReply } from 'fastify';
import { trace } from '@opentelemetry/api';
import {
  RateLimitTier,
  TIER_CONFIGS,
  getTierForRoute,
  isBlockedIP,
  isAllowedIP,
} from './tier-config.js';
import { requestContext } from '../observability/request-context.js';
import { RateLimitStore } from './rate-limit-store.js';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store.js';
import { getRedisClient } from '../cache/redis-client.js';
import { hashForTelemetry } from '../lib/telemetry-redaction.js';
import { loadEnv } from '../config/env.js';
import { RedisRateLimitStore } from './redis-rate-limit-store.js';
import * as metrics from '../observability/metrics/rate-limiting-metrics.js';

interface RateLimitInfo {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  tier: RateLimitTier;
}

export class TieredRateLimiter {
  private store: RateLimitStore;

  constructor(store?: RateLimitStore) {
    this.store = store || this.initializeStore();
  }

  getStore(): RateLimitStore {
    return this.store;
  }

  private initializeStore(): RateLimitStore {
    try {
      const env = loadEnv();
      const redis = getRedisClient(env);
      return new RedisRateLimitStore(redis, new InMemoryRateLimitStore());
    } catch (err) {
      const log = requestContext.getLog();
      log?.warn({ err }, 'Failed to initialize Redis store, using in-memory fallback');
      return new InMemoryRateLimitStore();
    }
  }

  async checkLimit(identifier: string, tier: RateLimitTier): Promise<RateLimitInfo> {
    const tracer = trace.getTracer('agrobridge.ratelimit');
    const config = TIER_CONFIGS[tier];
    const log = requestContext.getLog();

    return tracer.startActiveSpan(
      'rate_limit.check',
      {
        attributes: {
          'rate_limit.tier': tier,
          // identifier contains the raw client IP; hash it so the span never
          // carries PII to the telemetry backend (still allows correlation).
          'rate_limit.identifier': hashForTelemetry(identifier),
        },
      },
      async (span) => {
        const startTime = Date.now();
        try {
          const timeWindowMs = this.parseTimeWindow(config.timeWindow);
          const result = await this.store.incrementWithLimit(
            identifier,
            config.maxRequests,
            timeWindowMs,
          );
          const remaining = Math.max(0, config.maxRequests - result.count);
          const durationMs = Date.now() - startTime;

          span.setAttribute('rate_limit.allowed', result.allowed);
          span.setAttribute('rate_limit.limit', config.maxRequests);
          span.setAttribute('rate_limit.remaining', remaining);
          span.setAttribute('rate_limit.count', result.count);
          span.setAttribute('rate_limit.store_type', this.getStoreType());

          metrics.rateLimitChecksTotal.inc({
            tier,
            allowed: result.allowed ? 'true' : 'false',
            store_type: this.getStoreType(),
          });

          metrics.rateLimitLatency.observe(
            {
              tier,
              store_type: this.getStoreType(),
            },
            durationMs / 1000,
          );

          if (this.store.didFallback?.()) {
            metrics.rateLimitFallbacksTotal.inc({ reason: 'redis_error' });
          }

          if (result.allowed) {
            log?.debug(
              { identifier, tier, count: result.count, remaining },
              'Rate limit check passed',
            );
          } else {
            log?.warn(
              { identifier, tier, count: result.count, limit: config.maxRequests },
              'Rate limit exceeded',
            );
          }

          return {
            allowed: result.allowed,
            limit: config.maxRequests,
            remaining,
            resetTime: result.resetTime,
            tier,
          };
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });

          const config = TIER_CONFIGS[tier];
          metrics.rateLimitErrorsTotal.inc({
            tier,
            error_type: err instanceof Error ? err.name : 'unknown',
          });

          log?.error({ err, identifier, tier }, 'Rate limit check failed');

          if (config.skipOnError) {
            span.setAttribute('rate_limit.fail_open', true);
            log?.warn(
              { identifier, tier },
              'Rate limit check failed, allowing request (fail-open)',
            );

            const timeWindowMs = this.parseTimeWindow(config.timeWindow);
            return {
              allowed: true,
              limit: config.maxRequests,
              remaining: config.maxRequests,
              resetTime: new Date(Date.now() + timeWindowMs),
              tier,
            };
          }

          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private getStoreType(): 'redis' | 'in_memory' {
    if (this.store.constructor.name === 'RedisRateLimitStore') {
      return 'redis';
    }
    return 'in_memory';
  }

  async checkRequest(req: FastifyRequest, reply: FastifyReply): Promise<RateLimitInfo> {
    const ip = req.ip || 'unknown';
    const route = req.routeOptions.url || '/';
    const tier = getTierForRoute(route);

    if (isBlockedIP(ip, tier)) {
      return {
        allowed: false,
        limit: 0,
        remaining: 0,
        resetTime: new Date(Date.now() + 60000),
        tier: RateLimitTier.ABUSE,
      };
    }

    if (isAllowedIP(ip, tier)) {
      return {
        allowed: true,
        limit: Infinity,
        remaining: Infinity,
        resetTime: new Date(Date.now() + 60000),
        tier,
      };
    }

    return this.checkLimit(`${ip}:${route}`, tier);
  }

  private parseTimeWindow(window: string): number {
    const parts = window.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new Error(`Invalid time window format: "${window}". Expected: "<number> <unit>"`);
    }

    const valueStr = parts[0]!;
    const unit = parts[1]!;
    const num = parseInt(valueStr, 10);

    if (isNaN(num)) {
      throw new Error(`Invalid time window value: "${valueStr}" is not a number`);
    }

    if (num <= 0) {
      throw new Error(`Time window value must be positive: ${num}`);
    }

    const normalizedUnit = unit.toLowerCase().trim();
    const multipliers: Record<string, number> = {
      minute: 60,
      minutes: 60,
      hour: 3600,
      hours: 3600,
      day: 86400,
      days: 86400,
    };

    if (!(normalizedUnit in multipliers)) {
      const validUnits = Object.keys(multipliers).join(', ');
      throw new Error(`Unknown time unit: "${unit}". Valid units: ${validUnits}`);
    }

    const multiplier = multipliers[normalizedUnit];
    if (!multiplier) {
      throw new Error(`Invalid time unit multiplier for: ${normalizedUnit}`);
    }

    return num * multiplier * 1000;
  }
}

let limiter: TieredRateLimiter | null = null;
export function getTieredRateLimiter(): TieredRateLimiter {
  if (!limiter) {
    limiter = new TieredRateLimiter();
  }
  return limiter;
}
