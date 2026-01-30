import { describe, it, expect } from 'vitest';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';

describe('Rate Limiting Performance Regression Tests', () => {
  const BASELINE_P99_MS = 2.5;
  const BASELINE_RPS = 15000;

  describe('latency tests', () => {
    it('should maintain P99 < 5ms for 10k requests (in-memory)', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const latencies: number[] = [];

      for (let i = 0; i < 10000; i++) {
        const start = Date.now();
        await limiter.checkLimit(`user-${i}`, RateLimitTier.PUBLIC);
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99 = latencies[p99Index]!;

      expect(p99).toBeLessThan(5);

      const regressionRatio = p99 / BASELINE_P99_MS;
      expect(regressionRatio).toBeLessThan(1.2);
    });

    it('should maintain P99 < 5ms for 10k requests (unique identifiers)', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const latencies: number[] = [];

      for (let i = 0; i < 10000; i++) {
        const start = Date.now();
        await limiter.checkLimit(`perf-user-${i}`, RateLimitTier.PUBLIC);
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99 = latencies[p99Index]!;

      expect(p99).toBeLessThan(5);
      expect(p99 / BASELINE_P99_MS).toBeLessThan(1.2);
    });

    it('should maintain P95 < 2ms for 10k requests', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const latencies: number[] = [];

      for (let i = 0; i < 10000; i++) {
        const start = Date.now();
        await limiter.checkLimit(`user-${i}`, RateLimitTier.PUBLIC);
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95 = latencies[p95Index]!;

      expect(p95).toBeLessThan(2);
    });

    it('should maintain sub-millisecond P50 latency', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const latencies: number[] = [];

      for (let i = 0; i < 10000; i++) {
        const start = Date.now();
        await limiter.checkLimit(`user-${i}`, RateLimitTier.PUBLIC);
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50Index = Math.floor(latencies.length * 0.5);
      const p50 = latencies[p50Index]!;

      expect(p50).toBeLessThan(1);
    });
  });

  describe('throughput tests', () => {
    it('should maintain > 10k RPS for in-memory store', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const iterations = 10000;

      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        await limiter.checkLimit(`user-${i}`, RateLimitTier.PUBLIC);
      }

      const duration = Date.now() - start;
      const rps = (iterations / duration) * 1000;

      expect(rps).toBeGreaterThan(10000);
    });

    it('should maintain > 10k RPS under concurrent load', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const iterations = 10000;
      const concurrency = 100;
      const requestsPerBatch = Math.ceil(iterations / concurrency);

      const start = Date.now();

      const batches = Array.from({ length: concurrency }, async (_, batchIndex) => {
        for (let i = 0; i < requestsPerBatch; i++) {
          await limiter.checkLimit(`concurrent-user-${batchIndex}-${i}`, RateLimitTier.PUBLIC);
        }
      });

      await Promise.all(batches);

      const duration = Date.now() - start;
      const rps = (iterations / duration) * 1000;

      expect(rps).toBeGreaterThan(10000);
    });

    it('should maintain throughput for different rate limit tiers', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const tiers = [
        RateLimitTier.PUBLIC,
        RateLimitTier.STRICT,
        RateLimitTier.ADMIN,
        RateLimitTier.VIP_ADMIN,
      ];

      for (const tier of tiers) {
        const iterations = 1000;
        const start = Date.now();

        for (let i = 0; i < iterations; i++) {
          await limiter.checkLimit(`tier-${tier}-${i}`, tier);
        }

        const duration = Date.now() - start;
        const rps = (iterations / duration) * 1000;

        expect(rps).toBeGreaterThan(10000);
      }
    });
  });

  describe('memory tests', () => {
    it('should use < 50MB for 100k unique users', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const activeUsers = 100000;

      const memoryBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < activeUsers; i++) {
        await limiter.checkLimit(`memory-user-${i}`, RateLimitTier.PUBLIC);
      }

      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryUsedMB = (memoryAfter - memoryBefore) / 1024 / 1024;

      expect(memoryUsedMB).toBeLessThan(50);
    });

    it('should have bounded memory growth with cleanup', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const shortWindowMs = 100;

      const memoryBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < 50000; i++) {
        await limiter.checkLimit(`cleanup-user-${i}`, RateLimitTier.PUBLIC, shortWindowMs);
        if (i % 1000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const memoryMid = process.memoryUsage().heapUsed;
      const memoryAfterMid = (memoryMid - memoryBefore) / 1024 / 1024;

      await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 200));

      for (let i = 0; i < 50000; i++) {
        await limiter.checkLimit(`new-user-${i}`, RateLimitTier.PUBLIC, shortWindowMs);
      }

      const memoryAfter = process.memoryUsage().heapUsed;
      const memoryAfter2 = (memoryAfter - memoryMid) / 1024 / 1024;

      expect(memoryAfterMid).toBeLessThan(100);
      expect(memoryAfter2).toBeLessThan(memoryAfterMid * 1.5);
    });
  });

  describe('scalability tests', () => {
    it('should scale linearly with number of requests', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const scales = [1000, 5000, 10000, 20000];
      const timings: number[] = [];

      for (const scale of scales) {
        const start = Date.now();

        for (let i = 0; i < scale; i++) {
          await limiter.checkLimit(`scale-user-${scale}-${i}`, RateLimitTier.PUBLIC);
        }

        const timing = Date.now() - start;
        timings.push(timing);
      }

      for (let i = 1; i < timings.length; i++) {
        const expectedRatio = scales[i]! / scales[i - 1]!;
        const actualRatio = timings[i]! / timings[i - 1]!;

        expect(actualRatio).toBeLessThan(expectedRatio * 1.5);
      }
    });

    it('should handle burst traffic without performance degradation', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const baselineStart = Date.now();
      for (let i = 0; i < 1000; i++) {
        await limiter.checkLimit(`burst-baseline-${i}`, RateLimitTier.PUBLIC);
      }
      const baselineDuration = Date.now() - baselineStart;

      const burstStart = Date.now();
      const burstPromises = Array.from({ length: 5000 }, (_, i) =>
        limiter.checkLimit(`burst-user-${i}`, RateLimitTier.PUBLIC),
      );
      await Promise.all(burstPromises);
      const burstDuration = Date.now() - burstStart;

      const baselineRps = 1000 / baselineDuration;
      const burstRps = 5000 / burstDuration;

      const degradationRatio = baselineRps / burstRps;
      expect(degradationRatio).toBeLessThan(2);
    });
  });

  describe('resource usage tests', () => {
    it('should not leak event loop handles', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const processResourceUsage = process.resourceUsage as any;

      const before = processResourceUsage?.();

      for (let i = 0; i < 10000; i++) {
        await limiter.checkLimit(`handle-user-${i}`, RateLimitTier.PUBLIC);
      }

      const after = processResourceUsage?.();

      if (before && after) {
        const handleIncrease = after.handleCount - before.handleCount;
        expect(handleIncrease).toBeLessThan(100);
      }
    });

    it('should not accumulate excessive async resources', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());

      const initialAsyncResources = await getAsyncResourceCount();

      for (let i = 0; i < 10000; i++) {
        await limiter.checkLimit(`async-user-${i}`, RateLimitTier.PUBLIC);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const finalAsyncResources = await getAsyncResourceCount();
      const increase = finalAsyncResources - initialAsyncResources;

      expect(increase).toBeLessThan(50);
    });
  });

  describe('error handling performance', () => {
    it('should handle errors without significant latency impact', async () => {
      const limiter = new TieredRateLimiter(new InMemoryRateLimitStore());
      const latencies: number[] = [];

      for (let i = 0; i < 1000; i++) {
        const start = Date.now();
        try {
          await limiter.checkLimit(`error-user-${i}`, RateLimitTier.PUBLIC);
        } catch (err) {}
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99 = latencies[p99Index]!;

      expect(p99).toBeLessThan(5);
    });
  });
});

async function getAsyncResourceCount(): Promise<number> {
  if (process.getActiveResourcesInfo) {
    const resources = process.getActiveResourcesInfo();
    return resources.length;
  }
  return 0;
}
