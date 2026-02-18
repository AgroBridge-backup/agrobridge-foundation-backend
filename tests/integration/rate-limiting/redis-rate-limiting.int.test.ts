import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';
import { RedisRateLimitStore } from '../../../src/rate-limiting/redis-rate-limit-store.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';

const describeTier3 = process.env.TEST_TIER3 === '1' ? describe : describe.skip;

describe('Redis Rate Limiting Integration', () => {
  let redisContainer: StartedTestContainer;
  let redisClient: RedisClientType;

  beforeAll(async () => {
    redisContainer = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

    const redisPort = redisContainer.getMappedPort(6379);
    const redisHost = redisContainer.getHost();

    redisClient = createClient({
      socket: {
        host: redisHost,
        port: redisPort,
      },
    });

    await redisClient.connect();
  });

  afterAll(async () => {
    if (redisClient) {
      await redisClient.quit();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  describe('horizontal scaling', () => {
    it('should share rate limits across multiple instances', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter1 = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));
      const limiter2 = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));
      const limiter3 = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const identifier = 'test-user-1';
      const tier = RateLimitTier.PUBLIC;
      const maxRequests = 300;

      const result1 = await limiter1.checkLimit(identifier, tier);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(maxRequests - 1);

      const result2 = await limiter2.checkLimit(identifier, tier);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(maxRequests - 2);

      const result3 = await limiter3.checkLimit(identifier, tier);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(maxRequests - 3);

      expect(result1.limit).toBe(maxRequests);
      expect(result2.limit).toBe(maxRequests);
      expect(result3.limit).toBe(maxRequests);
    });

    it('should prevent rate limit bypass across instances', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter1 = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));
      const limiter2 = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const identifier = 'test-user-bypass';
      const tier = RateLimitTier.STRICT;

      for (let i = 0; i < 20; i++) {
        await limiter1.checkLimit(identifier, tier);
      }

      const result1 = await limiter1.checkLimit(identifier, tier);
      expect(result1.allowed).toBe(false);

      const result2 = await limiter2.checkLimit(identifier, tier);
      expect(result2.allowed).toBe(false);
      expect(result2.remaining).toBe(0);
    });
  });

  describe('Redis failure handling', () => {
    it('should fail open when Redis is unavailable', async () => {
      const badRedisClient = createClient({
        socket: {
          host: 'localhost',
          port: 9999,
        },
      });

      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(
        new RedisRateLimitStore(badRedisClient as any, fallback),
      );

      const result = await limiter.checkLimit('user1', RateLimitTier.PUBLIC);

      expect(result.allowed).toBe(true);
    });

    it('should recover when Redis becomes available', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const result1 = await limiter.checkLimit('user1', RateLimitTier.PUBLIC);
      expect(result1.allowed).toBe(true);

      await redisClient.flushAll();

      const result2 = await limiter.checkLimit('user1', RateLimitTier.PUBLIC);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(299);
    });
  });

  describeTier3('performance benchmarks', () => {
    it('should meet P99 latency < 5ms target', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const iterations = 1000;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await limiter.checkLimit(`user${i}`, RateLimitTier.PUBLIC);
        const end = Date.now();
        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(iterations * 0.99);
      const p99Latency = latencies[p99Index];

      expect(p99Latency).toBeLessThan(5);
    }, 30000);

    it('should handle > 10,000 checks/second', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const iterations = 10000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        await limiter.checkLimit(`user${i}`, RateLimitTier.PUBLIC);
      }

      const end = Date.now();
      const duration = end - start;
      const throughput = (iterations / duration) * 1000;

      expect(throughput).toBeGreaterThan(10000);
    }, 30000);
  });
});
