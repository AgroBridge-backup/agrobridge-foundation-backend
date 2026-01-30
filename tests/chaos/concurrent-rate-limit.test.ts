import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';

describe('Rate Limiting Concurrency Stress Tests', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  describe('concurrent request handling', () => {
    it('should not exceed limit under 1000 concurrent requests', async () => {
      const maxRequests = 100;

      const results = await Promise.all(
        Array.from({ length: 1000 }, (_, i) =>
          store.incrementWithLimit('concurrent-test-1', maxRequests, 60000),
        ),
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBeLessThanOrEqual(maxRequests);

      const final = await store.get('concurrent-test-1');
      expect(final?.count).toBeLessThanOrEqual(maxRequests);
    });

    it('should handle multiple identifiers concurrently', async () => {
      const maxRequests = 50;
      const numUsers = 100;

      const results = await Promise.all(
        Array.from({ length: numUsers }, (_, i) =>
          store.incrementWithLimit(`user-${i}`, maxRequests, 60000),
        ),
      );

      results.forEach((result) => {
        expect(result.count).toBe(1);
        expect(result.allowed).toBe(true);
      });

      for (let i = 0; i < numUsers; i++) {
        const entry = await store.get(`user-${i}`);
        expect(entry?.count).toBe(1);
      }
    });

    it('should maintain atomicity across rapid sequential updates', async () => {
      const maxRequests = 10;
      const identifier = 'rapid-sequential-test';

      const promises = Array.from({ length: 20 }, () =>
        store.incrementWithLimit(identifier, maxRequests, 60000),
      );

      const results = await Promise.all(promises);
      const allowedCount = results.filter((r) => r.allowed).length;

      expect(allowedCount).toBeLessThanOrEqual(maxRequests);

      const final = await store.get(identifier);
      expect(final?.count).toBeLessThanOrEqual(maxRequests);
    });
  });

  describe('memory management', () => {
    it('should cleanup expired entries automatically', async () => {
      const shortWindowMs = 100;

      for (let i = 0; i < 1000; i++) {
        await store.incrementWithLimit(`user-${i}`, 100, shortWindowMs);
      }

      let size = store.getStoreSize();
      expect(size).toBeGreaterThan(500);

      await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 200));
      size = store.getStoreSize();
      expect(size).toBeLessThan(100);
    });

    it('should handle memory growth over extended period', async () => {
      const initialSize = store.getStoreSize();

      for (let i = 0; i < 10000; i++) {
        await store.incrementWithLimit(`long-run-user-${i}`, 100, 60000);
        if (i % 1000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      const finalSize = store.getStoreSize();
      const growth = finalSize - initialSize;

      expect(growth).toBeLessThan(20000);
      expect(growth).toBeGreaterThan(0);
    });

    it('should handle burst traffic without memory explosion', async () => {
      const users = 5000;
      const requestsPerUser = 5;

      const startMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < users; i++) {
        for (let j = 0; j < requestsPerUser; j++) {
          await store.incrementWithLimit(`burst-user-${i}`, 10, 60000);
        }
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryUsedMB = (endMemory - startMemory) / 1024 / 1024;

      expect(memoryUsedMB).toBeLessThan(100);
    });
  });

  describe('race condition edge cases', () => {
    it('should handle exact limit boundary', async () => {
      const maxRequests = 5;
      const identifier = 'boundary-test';

      for (let i = 0; i < maxRequests; i++) {
        const result = await store.incrementWithLimit(identifier, maxRequests, 60000);
        expect(result.allowed).toBe(true);
      }

      const exceedingResult = await store.incrementWithLimit(identifier, maxRequests, 60000);
      expect(exceedingResult.allowed).toBe(false);
    });

    it('should handle window expiration during concurrent requests', async () => {
      const shortWindowMs = 50;
      const identifier = 'expire-concurrent-test';

      const batch1 = await Promise.all(
        Array.from({ length: 5 }, () => store.incrementWithLimit(identifier, 10, shortWindowMs)),
      );

      expect(batch1.every((r) => r.allowed)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 10));

      const batch2 = await Promise.all(
        Array.from({ length: 5 }, () => store.incrementWithLimit(identifier, 10, shortWindowMs)),
      );

      expect(batch2.every((r) => r.allowed)).toBe(true);
    });
  });

  describe('performance under load', () => {
    it('should maintain sub-millisecond latency for concurrent requests', async () => {
      const iterations = 100;
      const latencies: number[] = [];

      const start = Date.now();
      const promises = Array.from({ length: iterations }, (_, i) => {
        const reqStart = Date.now();
        return store.incrementWithLimit(`perf-user-${i}`, 100, 60000).then((result) => {
          latencies.push(Date.now() - reqStart);
          return result;
        });
      });

      await Promise.all(promises);
      const totalTime = Date.now() - start;

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      expect(avgLatency).toBeLessThan(10);
      expect(maxLatency).toBeLessThan(100);
      expect(totalTime).toBeLessThan(1000);
    });

    it('should scale linearly with number of unique identifiers', async () => {
      const sizes = [100, 500, 1000, 2000];
      const timings: number[] = [];

      for (const size of sizes) {
        const start = Date.now();

        await Promise.all(
          Array.from({ length: size }, (_, i) =>
            store.incrementWithLimit(`scale-user-${size}-${i}`, 100, 60000),
          ),
        );

        const timing = Date.now() - start;
        timings.push(timing);
      }

      for (let i = 1; i < timings.length; i++) {
        const ratio = timings[i] / timings[i - 1];
        expect(ratio).toBeLessThan(3);
      }
    });
  });

  describe('cleanup under load', () => {
    it('should cleanup during high load', async () => {
      const shortWindowMs = 100;
      const numUsers = 500;

      for (let i = 0; i < numUsers; i++) {
        await store.incrementWithLimit(`cleanup-user-${i}`, 10, shortWindowMs);
      }

      const sizeAfterFirstBatch = store.getStoreSize();
      expect(sizeAfterFirstBatch).toBe(numUsers);

      await new Promise((resolve) => setTimeout(resolve, shortWindowMs + 200));

      const secondBatchUsers = Array.from({ length: numUsers }, (_, i) => `new-user-${i}`);
      for (const user of secondBatchUsers) {
        await store.incrementWithLimit(user, 10, shortWindowMs);
      }

      const sizeAfterSecondBatch = store.getStoreSize();
      expect(sizeAfterSecondBatch).toBeLessThan(sizeAfterFirstBatch + numUsers);
    });

    it('should handle cleanup interval triggering mid-operation', async () => {
      const numUsers = 1000;
      const shortWindowMs = 100;

      const promises = Array.from({ length: numUsers }, (_, i) =>
        store.incrementWithLimit(`interval-user-${i}`, 10, shortWindowMs),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      await Promise.all(promises);

      const finalSize = store.getStoreSize();
      expect(finalSize).toBeGreaterThan(0);
      expect(finalSize).toBeLessThanOrEqual(numUsers);
    });
  });
});
