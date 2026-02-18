import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import {
  average,
  getEnvNumber,
  isTier3Enabled,
  nowMs,
  ratio,
  sleep,
} from '../helpers/reliability-tier.js';

const describeTier3 = isTier3Enabled() ? describe : describe.skip;
const EXPIRY_BUFFER_MS = getEnvNumber('TEST_TIER3_EXPIRY_BUFFER_MS', 40);
const CLEANUP_BUFFER_MS = getEnvNumber('TEST_TIER3_CLEANUP_BUFFER_MS', 250);
const INSERT_FILL_RATIO_MIN = getEnvNumber('TEST_TIER3_INSERT_FILL_RATIO_MIN', 0.9);
const CLEANUP_RESIDUAL_RATIO_MAX = getEnvNumber('TEST_TIER3_CLEANUP_RESIDUAL_RATIO_MAX', 0.2);
const STORE_GROWTH_MIN_RATIO = getEnvNumber('TEST_TIER3_STORE_GROWTH_MIN_RATIO', 0.85);
const STORE_GROWTH_MAX_RATIO = getEnvNumber('TEST_TIER3_STORE_GROWTH_MAX_RATIO', 1.15);
const EXTRA_PASS_MEMORY_RATIO_MAX = getEnvNumber('TEST_TIER3_EXTRA_PASS_MEMORY_RATIO_MAX', 0.6);
const EXTRA_PASS_MEMORY_FLOOR_MB = getEnvNumber('TEST_TIER3_EXTRA_PASS_MEMORY_FLOOR_MB', 8);
const CONCURRENT_AVG_RATIO_MAX = getEnvNumber('TEST_TIER3_CONCURRENT_AVG_RATIO_MAX', 10);
const CONCURRENT_MAX_TO_AVG_RATIO_MAX = getEnvNumber('TEST_TIER3_CONCURRENT_MAX_TO_AVG_RATIO_MAX', 20);
const CONCURRENT_TOTAL_RATIO_MAX = getEnvNumber('TEST_TIER3_CONCURRENT_TOTAL_RATIO_MAX', 2.5);
const SCALE_ENVELOPE_FACTOR = getEnvNumber('TEST_TIER3_SCALE_ENVELOPE_FACTOR', 1.7);
const SCALE_ENVELOPE_OVERHEAD = getEnvNumber('TEST_TIER3_SCALE_ENVELOPE_OVERHEAD', 1.4);
const SCALE_REPEAT_RUNS = Math.floor(getEnvNumber('TEST_TIER3_SCALE_REPEAT_RUNS', 3));
const SCALE_RUN_PAUSE_MS = getEnvNumber('TEST_TIER3_SCALE_RUN_PAUSE_MS', 10);
const CLEANUP_REFILL_RATIO_MAX = getEnvNumber('TEST_TIER3_CLEANUP_REFILL_RATIO_MAX', 1.3);
const MID_OPERATION_DELAY_MS = getEnvNumber('TEST_TIER3_MID_OPERATION_DELAY_MS', 50);

describeTier3('Rate Limiting Concurrency Stress Tests', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  describe('concurrent request handling', () => {
    it('should not exceed limit under 1000 concurrent requests', async () => {
      const maxRequests = 100;

      const results = await Promise.all(
        Array.from({ length: 1000 }, () =>
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
    it('should cleanup expired entries within an expected residual envelope', async () => {
      const shortWindowMs = 100;
      const insertedUsers = 1000;

      for (let i = 0; i < insertedUsers; i++) {
        await store.incrementWithLimit(`user-${i}`, 100, shortWindowMs);
      }

      const sizeAfterInsert = store.getStoreSize();
      expect(sizeAfterInsert).toBeGreaterThanOrEqual(Math.floor(insertedUsers * INSERT_FILL_RATIO_MIN));

      await sleep(shortWindowMs + CLEANUP_BUFFER_MS);
      store.cleanup();

      const sizeAfterCleanup = store.getStoreSize();
      const residualRatio = ratio(sizeAfterCleanup, Math.max(1, sizeAfterInsert));
      expect(residualRatio).toBeLessThanOrEqual(CLEANUP_RESIDUAL_RATIO_MAX);
    });

    it('should keep store growth near inserted identifier count over time', async () => {
      const users = 10000;
      const initialSize = store.getStoreSize();

      for (let i = 0; i < users; i++) {
        await store.incrementWithLimit(`long-run-user-${i}`, 100, 60000);
        if (i % 1000 === 0) {
          await sleep(100);
        }
      }

      const finalSize = store.getStoreSize();
      const growth = finalSize - initialSize;
      expect(growth).toBeGreaterThanOrEqual(Math.floor(users * STORE_GROWTH_MIN_RATIO));
      expect(growth).toBeLessThanOrEqual(Math.ceil(users * STORE_GROWTH_MAX_RATIO));
    });

    it('should keep extra heap growth bounded after repeated user keys', async () => {
      const users = 5000;
      const requestsPerUser = 5;

      const startMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < users; i++) {
        await store.incrementWithLimit(`burst-user-${i}`, 10, 60000);
      }
      const memoryAfterFirstPass = process.memoryUsage().heapUsed;

      for (let j = 1; j < requestsPerUser; j++) {
        for (let i = 0; i < users; i++) {
          await store.incrementWithLimit(`burst-user-${i}`, 10, 60000);
        }
      }

      const memoryAfterBurst = process.memoryUsage().heapUsed;

      const firstPassGrowthMB = Math.max(0, (memoryAfterFirstPass - startMemory) / 1024 / 1024);
      const extraPassGrowthMB = Math.max(0, (memoryAfterBurst - memoryAfterFirstPass) / 1024 / 1024);

      const maxExtraGrowthMB = Math.max(
        EXTRA_PASS_MEMORY_FLOOR_MB,
        firstPassGrowthMB * EXTRA_PASS_MEMORY_RATIO_MAX,
      );

      expect(extraPassGrowthMB).toBeLessThanOrEqual(maxExtraGrowthMB);
      expect(store.getStoreSize()).toBeLessThanOrEqual(users);
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

      await sleep(shortWindowMs + EXPIRY_BUFFER_MS);

      const batch2 = await Promise.all(
        Array.from({ length: 5 }, () => store.incrementWithLimit(identifier, 10, shortWindowMs)),
      );
      expect(batch2.every((r) => r.allowed)).toBe(true);
    });
  });

  describe('performance under load', () => {
    it('should keep concurrent latency stable across repeated bursts', async () => {
      const iterations = 250;
      const firstRunLatencies: number[] = [];
      const secondRunLatencies: number[] = [];

      const firstRunStart = nowMs();
      await Promise.all(
        Array.from({ length: iterations }, (_, i) => {
          const opStart = nowMs();
          return store.incrementWithLimit(`perf-run-1-${i}`, 100, 60000).then(() => {
            firstRunLatencies.push(nowMs() - opStart);
          });
        }),
      );
      const firstRunTotalMs = nowMs() - firstRunStart;

      const secondRunStart = nowMs();
      await Promise.all(
        Array.from({ length: iterations }, (_, i) => {
          const opStart = nowMs();
          return store.incrementWithLimit(`perf-run-2-${i}`, 100, 60000).then(() => {
            secondRunLatencies.push(nowMs() - opStart);
          });
        }),
      );
      const secondRunTotalMs = nowMs() - secondRunStart;

      const firstRunAvg = average(firstRunLatencies);
      const secondRunAvg = average(secondRunLatencies);
      const secondRunMax = Math.max(...secondRunLatencies);

      expect(ratio(secondRunAvg, Math.max(firstRunAvg, 0.001))).toBeLessThanOrEqual(
        CONCURRENT_AVG_RATIO_MAX,
      );
      expect(ratio(secondRunMax, Math.max(secondRunAvg, 0.001))).toBeLessThanOrEqual(
        CONCURRENT_MAX_TO_AVG_RATIO_MAX,
      );
      expect(ratio(secondRunTotalMs, Math.max(firstRunTotalMs, 0.001))).toBeLessThanOrEqual(
        CONCURRENT_TOTAL_RATIO_MAX,
      );
    });

    it('should scale linearly with number of unique identifiers', async () => {
      const sizes = [100, 500, 1000, 2000];
      const timings: number[] = [];

      for (const size of sizes) {
        const runTimings: number[] = [];
        for (let run = 0; run < SCALE_REPEAT_RUNS; run++) {
          const start = nowMs();

          await Promise.all(
            Array.from({ length: size }, (_, i) =>
              store.incrementWithLimit(`scale-user-${size}-${run}-${i}`, 100, 60000),
            ),
          );
          runTimings.push(nowMs() - start);
          await sleep(SCALE_RUN_PAUSE_MS);
        }

        timings.push(average(runTimings));
      }

      for (let i = 1; i < timings.length; i++) {
        const expectedRatio = sizes[i]! / sizes[i - 1]!;
        const actualRatio = timings[i]! / Math.max(timings[i - 1]!, 0.001);
        const allowedRatio = expectedRatio * SCALE_ENVELOPE_FACTOR + SCALE_ENVELOPE_OVERHEAD;
        expect(actualRatio).toBeLessThanOrEqual(allowedRatio);
      }
    });
  });

  describe('cleanup under load', () => {
    it('should cleanup during high load without uncontrolled refill growth', async () => {
      const shortWindowMs = 100;
      const numUsers = 500;

      for (let i = 0; i < numUsers; i++) {
        await store.incrementWithLimit(`cleanup-user-${i}`, 10, shortWindowMs);
      }

      const sizeAfterFirstBatch = store.getStoreSize();
      expect(sizeAfterFirstBatch).toBeGreaterThanOrEqual(Math.floor(numUsers * INSERT_FILL_RATIO_MIN));

      await sleep(shortWindowMs + CLEANUP_BUFFER_MS);
      store.cleanup();

      for (let i = 0; i < numUsers; i++) {
        await store.incrementWithLimit(`new-user-${i}`, 10, shortWindowMs);
      }

      const sizeAfterSecondBatch = store.getStoreSize();
      expect(sizeAfterSecondBatch).toBeLessThanOrEqual(Math.ceil(numUsers * CLEANUP_REFILL_RATIO_MAX));
    });

    it('should handle cleanup interval triggering mid-operation', async () => {
      const numUsers = 1000;
      const shortWindowMs = 100;

      const promises = Array.from({ length: numUsers }, (_, i) =>
        store.incrementWithLimit(`interval-user-${i}`, 10, shortWindowMs),
      );

      await sleep(MID_OPERATION_DELAY_MS);
      await Promise.all(promises);

      const finalSize = store.getStoreSize();
      expect(finalSize).toBeGreaterThan(0);
      expect(finalSize).toBeLessThanOrEqual(numUsers);
    });
  });
});
