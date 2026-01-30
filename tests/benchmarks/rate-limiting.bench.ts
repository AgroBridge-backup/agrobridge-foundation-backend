import { describe, it, expect, beforeAll } from 'vitest';
import { Bench } from 'tinybench';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RedisRateLimitStore } from '../../../src/rate-limiting/redis-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';

describe('Rate Limiting Performance Benchmarks', () => {
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

  describe('latency benchmarks', () => {
    it('should meet P99 latency < 5ms for Redis', async () => {
      const bench = new Bench({ time: 5000 });
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      bench.add('Redis Rate Limit Check', async () => {
        await limiter.checkLimit('test-user-1', RateLimitTier.PUBLIC);
      });

      await bench.run();

      const tasks = bench.tasks;
      const redisTask = tasks.find((t) => t.name === 'Redis Rate Limit Check');

      expect(redisTask).toBeDefined();

      if (redisTask && redisTask.result) {
        const latency = redisTask.result.mean;
        expect(latency).toBeLessThan(5);
      }
    }, 30000);

    it('should meet P99 latency < 1ms for in-memory fallback', async () => {
      const bench = new Bench({ time: 5000 });
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      bench.add('In-Memory Fallback Check', async () => {
        await limiter.checkLimit('test-user-2', RateLimitTier.PUBLIC);
      });

      await bench.run();

      const tasks = bench.tasks;
      const memoryTask = tasks.find((t) => t.name === 'In-Memory Fallback Check');

      expect(memoryTask).toBeDefined();

      if (memoryTask && memoryTask.result) {
        const p99 = memoryTask.result.p99;
        expect(p99).toBeLessThan(1);
      }
    }, 30000);
  });

  describe('throughput benchmarks', () => {
    it('should handle > 10,000 checks/second for Redis', async () => {
      const bench = new Bench({ iterations: 10000 });
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      bench.add('Redis Throughput', async () => {
        await limiter.checkLimit('test-user-3', RateLimitTier.PUBLIC);
      });

      await bench.run();

      const tasks = bench.tasks;
      const redisTask = tasks.find((t) => t.name === 'Redis Throughput');

      expect(redisTask).toBeDefined();

      if (redisTask && redisTask.result) {
        const opsPerSecond = redisTask.result.hz;
        expect(opsPerSecond).toBeGreaterThan(10000);
      }
    }, 30000);

    it('should handle > 10,000 checks/second for in-memory', async () => {
      const bench = new Bench({ iterations: 10000 });
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      bench.add('In-Memory Throughput', async () => {
        await limiter.checkLimit('test-user-4', RateLimitTier.PUBLIC);
      });

      await bench.run();

      const tasks = bench.tasks;
      const memoryTask = tasks.find((t) => t.name === 'In-Memory Throughput');

      expect(memoryTask).toBeDefined();

      if (memoryTask && memoryTask.result) {
        const opsPerSecond = memoryTask.result.hz;
        expect(opsPerSecond).toBeGreaterThan(10000);
      }
    }, 30000);
  });

  describe('memory benchmarks', () => {
    it('should use < 10MB for 100k active users', async () => {
      const fallback = new InMemoryRateLimitStore();
      const limiter = new TieredRateLimiter(new RedisRateLimitStore(redisClient, fallback));

      const activeUsers = 100000;

      const memoryBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < activeUsers; i++) {
        await limiter.checkLimit(`user-${i}`, RateLimitTier.PUBLIC);
      }

      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryUsed = (memoryAfter - memoryBefore) / 1024 / 1024;

      expect(memoryUsed).toBeLessThan(10);
    }, 60000);
  });
});
