import type { RedisClientType } from 'redis';
import { trace } from '@opentelemetry/api';
import { requestContext } from '../observability/request-context.js';

export interface CacheOptions {
  ttlMs?: number;
  keyPrefix?: string;
}

export class CacheService {
  constructor(
    private readonly redis: RedisClientType,
    private readonly defaultTtlMs: number = 60_000,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const tracer = trace.getTracer('agrobridge.cache');
    return tracer.startActiveSpan(
      'cache.get',
      { attributes: { 'cache.key': key } },
      async (span) => {
        try {
          const value = await this.redis.get(key);
          if (value === null) {
            span.setStatus({ code: 1 });
            return null;
          }
          const parsed = JSON.parse(value);
          span.setAttribute('cache.hit', true);
          return parsed as T;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });
          const log = requestContext.getLog();
          log?.error({ err, key }, 'Cache get failed');
          return null;
        } finally {
          span.end();
        }
      },
    );
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const tracer = trace.getTracer('agrobridge.cache');
    const ttl = ttlMs ?? this.defaultTtlMs;
    return tracer.startActiveSpan(
      'cache.set',
      { attributes: { 'cache.key': key, 'cache.ttl': ttl } },
      async (span) => {
        try {
          await this.redis.setEx(key, Math.ceil(ttl / 1000), JSON.stringify(value));
          span.setAttribute('cache.hit', false);
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });
          const log = requestContext.getLog();
          log?.error({ err, key }, 'Cache set failed');
        } finally {
          span.end();
        }
      },
    );
  }

  async del(key: string): Promise<void> {
    const tracer = trace.getTracer('agrobridge.cache');
    return tracer.startActiveSpan(
      'cache.del',
      { attributes: { 'cache.key': key } },
      async (span) => {
        try {
          await this.redis.del(key);
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });
          const log = requestContext.getLog();
          log?.error({ err, key }, 'Cache delete failed');
        } finally {
          span.end();
        }
      },
    );
  }

  async delPattern(pattern: string): Promise<void> {
    const tracer = trace.getTracer('agrobridge.cache');
    return tracer.startActiveSpan(
      'cache.del_pattern',
      { attributes: { 'cache.pattern': pattern } },
      async (span) => {
        try {
          const keys = await this.redis.keys(pattern);
          if (keys.length > 0) {
            await this.redis.del(keys);
          }
          span.setAttribute('cache.keys_deleted', keys.length);
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: 2 });
          const log = requestContext.getLog();
          log?.error({ err, pattern }, 'Cache del_pattern failed');
        } finally {
          span.end();
        }
      },
    );
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }
}
