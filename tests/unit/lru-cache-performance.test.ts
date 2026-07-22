import { describe, it, expect } from 'vitest';
import { LRUCache } from '../../src/utils/lru-cache.js';
import { getEnvNumber, isTier3Enabled, ratio } from '../helpers/reliability-tier.js';

const describeTier3 = isTier3Enabled() ? describe : describe.skip;

const GET_SCALE_RATIO_MAX = getEnvNumber('TEST_TIER3_LRU_GET_SCALE_RATIO_MAX', 2.4);
const SET_STABILITY_RATIO_MAX = getEnvNumber('TEST_TIER3_LRU_SET_STABILITY_RATIO_MAX', 2.4);
const SET_STABILITY_ITERATIONS = Math.floor(getEnvNumber('TEST_TIER3_LRU_SET_STABILITY_ITERATIONS', 80000));
const DELETE_STABILITY_RATIO_MAX = getEnvNumber('TEST_TIER3_LRU_DELETE_STABILITY_RATIO_MAX', 2.0);

describeTier3('LRUCache - Performance', () => {
  describe('O(1) operation envelopes', () => {
    it('keeps get latency growth bounded when cache size increases', () => {
      const smallCacheSize = 10000;
      const largeCacheSize = 100000;
      const iterations = 10000;

      const smallCache = createFilledCache(smallCacheSize);
      const largeCache = createFilledCache(largeCacheSize);

      const smallGetUs = measureOperationLatencyUs(iterations, (index) => {
        smallCache.get(`key-${index % smallCacheSize}`);
      });
      const largeGetUs = measureOperationLatencyUs(iterations, (index) => {
        largeCache.get(`key-${index % largeCacheSize}`);
      });

      expect(ratio(largeGetUs, Math.max(0.001, smallGetUs))).toBeLessThanOrEqual(GET_SCALE_RATIO_MAX);
    });

    it('keeps set with eviction latency stable across repeated runs', () => {
      const cache = new LRUCache<string, number>(10000);
      const iterations = SET_STABILITY_ITERATIONS;

      const firstRunUs = measureOperationLatencyUs(iterations, (index) => {
        cache.set(`first-run-${index}`, index);
      });
      const secondRunUs = measureOperationLatencyUs(iterations, (index) => {
        cache.set(`second-run-${index}`, index);
      });

      const stabilityRatio = ratio(secondRunUs, Math.max(0.001, firstRunUs));
      expect(stabilityRatio).toBeLessThanOrEqual(SET_STABILITY_RATIO_MAX);
      expect(cache.size).toBeLessThanOrEqual(10000);
    });

    it('keeps delete latency stable across repeated runs', () => {
      const entries = 30000;
      const iterations = 10000;

      const firstCache = createFilledCache(entries);
      const secondCache = createFilledCache(entries);

      const firstRunUs = measureOperationLatencyUs(iterations, (index) => {
        firstCache.delete(`key-${index}`);
      });
      const secondRunUs = measureOperationLatencyUs(iterations, (index) => {
        secondCache.delete(`key-${index}`);
      });

      const stabilityRatio = ratio(secondRunUs, Math.max(0.001, firstRunUs));
      expect(stabilityRatio).toBeLessThanOrEqual(DELETE_STABILITY_RATIO_MAX);
    });
  });

  describe('functional invariants under perf load', () => {
    it('never exceeds max size under sustained writes', () => {
      const cache = new LRUCache<string, number>(1000);

      for (let round = 0; round < 100; round++) {
        for (let i = 0; i < 100; i++) {
          cache.set(`key-${round * 100 + i}`, i);
          expect(cache.size).toBeLessThanOrEqual(1000);
        }
      }
    });

    it('maintains LRU order correctly', () => {
      const cache = new LRUCache<string, number>(3);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a');
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('tracks hit rate accurately', () => {
      const cache = new LRUCache<string, number>(100);

      for (let i = 0; i < 50; i++) {
        cache.set(`key-${i}`, i);
      }

      for (let i = 0; i < 80; i++) {
        cache.get(`key-${i % 50}`);
      }

      for (let i = 0; i < 20; i++) {
        cache.get(`missing-${i}`);
      }

      const stats = cache.getStats();
      expect(stats.hits).toBe(80);
      expect(stats.misses).toBe(20);
      expect(stats.hitRate).toBeCloseTo(0.8, 2);
    });
  });

  describe('deterministic stress test', () => {
    it('handles deterministic mixed operations without invariant breaks', () => {
      const cache = new LRUCache<string, object>(10000);
      const errors: Error[] = [];
      const random = createDeterministicRandom(0xc0ffee);

      try {
        for (let i = 0; i < 100000; i++) {
          const key = `key-${Math.floor(random() * 15000)}`;
          const action = random();

          if (action < 0.4) {
            cache.set(key, { id: i, data: 'x'.repeat(100) });
          } else if (action < 0.9) {
            cache.get(key);
          } else {
            cache.delete(key);
          }

          if (cache.size > 10000) {
            errors.push(new Error(`Cache exceeded max size: ${cache.size}`));
          }
        }
      } catch (err) {
        errors.push(err as Error);
      }

      expect(errors.length).toBe(0);
      expect(cache.size).toBeLessThanOrEqual(10000);
    });
  });
});

function createFilledCache(size: number): LRUCache<string, number> {
  const cache = new LRUCache<string, number>(size);
  for (let i = 0; i < size; i++) {
    cache.set(`key-${i}`, i);
  }
  return cache;
}

function measureOperationLatencyUs(
  iterations: number,
  operation: (iteration: number) => void,
): number {
  const start = process.hrtime.bigint();

  for (let i = 0; i < iterations; i++) {
    operation(i);
  }

  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  return (durationMs * 1000) / iterations;
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
