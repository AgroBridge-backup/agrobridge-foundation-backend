import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { RedisClientType } from 'redis';
import { RateLimitStore, RateLimitResult, RateLimitEntry } from './rate-limit-store.js';
import { requestContext } from '../observability/request-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LUA_TOKEN_BUCKET_SCRIPT = readFileSync(join(__dirname, 'token-bucket-lua.lua'), 'utf-8');

export interface TokenBucketConfig {
  rate: number;
  capacity: number;
}

export class TokenBucketRateLimiter implements RateLimitStore {
  private readonly redis: RedisClientType;
  private readonly logger: ReturnType<typeof requestContext.getLog>;
  private readonly buckets: Map<string, TokenBucketConfig>;

  constructor(redis: RedisClientType) {
    this.redis = redis;
    this.logger = requestContext.getLog();
    this.buckets = new Map();
  }

  configureBucket(identifier: string, config: TokenBucketConfig): void {
    this.buckets.set(identifier, config);
  }

  getBucketConfig(identifier: string): TokenBucketConfig | undefined {
    return this.buckets.get(identifier);
  }

  async get(identifier: string): Promise<RateLimitEntry | null> {
    try {
      const key = `tokenbucket:${identifier}`;
      const hash = await this.redis.hGetAll(key);

      if (!hash || Object.keys(hash).length === 0) {
        return null;
      }

      const tokens = parseFloat(hash.tokens || '0');
      const lastRefill = parseInt(hash.lastRefill || '0', 10);
      const config = this.buckets.get(identifier);
      const capacity = config?.capacity ?? 100;

      // Convert token bucket state to rate limit entry format
      return {
        count: Math.max(0, capacity - Math.floor(tokens)),
        resetTime: new Date(lastRefill + (config?.rate ? 1000 / config.rate : 60000)),
      };
    } catch (err) {
      this.logger?.error({ err, identifier }, 'Failed to get token bucket state');
      return null;
    }
  }

  async incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult> {
    const config = this.buckets.get(identifier) || {
      rate: maxRequests / (timeWindowMs / 1000),
      capacity: maxRequests,
    };

    const now = Date.now();

    try {
      const result = await this.redis.eval(LUA_TOKEN_BUCKET_SCRIPT, {
        keys: [`tokenbucket:${identifier}`],
        arguments: [config.rate.toString(), config.capacity.toString(), '1', now.toString()],
      });

      if (!result || !Array.isArray(result)) {
        throw new Error('Invalid Redis response');
      }

      const [allowed, remainingTokens] = result as [number, number];

      this.logger?.debug(
        { identifier, allowed, remaining: remainingTokens, capacity: config.capacity },
        'Token bucket rate limit check',
      );

      const resetTime = new Date(now + ((config.capacity - remainingTokens) / config.rate) * 1000);

      return {
        count: config.capacity - remainingTokens,
        allowed: allowed === 1,
        resetTime,
      };
    } catch (err) {
      this.logger?.error({ err, identifier }, 'Token bucket rate limit check failed');
      throw err;
    }
  }

  async delete(identifier: string): Promise<void> {
    try {
      await this.redis.del(`tokenbucket:${identifier}`);
    } catch (err) {
      this.logger?.error({ err, identifier }, 'Failed to delete token bucket');
    }
  }

  async cleanup(): Promise<void> {
    this.logger?.info('Token bucket cleanup not needed - Redis handles expiration');
  }

  private getRedisKey(identifier: string): string {
    return `tokenbucket:${identifier}`;
  }
}
