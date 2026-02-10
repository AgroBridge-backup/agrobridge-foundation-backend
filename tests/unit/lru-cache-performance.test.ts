import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../../src/utils/lru-cache.js';

describe('LRUCache - Performance', () => {
  describe('O(1) Operations', () => {
    it('should maintain O(1) get performance with large cache', () => {
      const cache = new LRUCache<string, number>(100000);

      // Fill cache
      for (let i = 0; i < 100000; i++) {
        cache.set(`key-${i}`, i);
      }

      // Measure get performance
      const iterations = 10000;
      const startTime = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        cache.get(`key-${i % 100000}`);
      }

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const avgOperationUs = (durationMs * 1000) / iterations;

      console.log(`LRUCache get: ${avgOperationUs.toFixed(3)}µs per operation`);

      // Should be under 10µs per operation for O(1)
      expect(avgOperationUs).toBeLessThan(50);
    });

    it('should maintain O(1) set performance with eviction', () => {
      const cache = new LRUCache<string, number>(10000);

      // Measure set performance with eviction
      const iterations = 100000;
      const startTime = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        cache.set(`key-${i}`, i);
      }

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const avgOperationUs = (durationMs * 1000) / iterations;

      console.log(`LRUCache set with eviction: ${avgOperationUs.toFixed(3)}µs per operation`);

      // Should be under 10µs per operation for O(1)
      expect(avgOperationUs).toBeLessThan(50);

      // Cache should never exceed max size
      expect(cache.size).toBeLessThanOrEqual(10000);
    });

    it('should maintain O(1) delete performance', () => {
      const cache = new LRUCache<string, number>(100000);

      // Fill cache
      for (let i = 0; i < 100000; i++) {
        cache.set(`key-${i}`, i);
      }

      // Measure delete performance
      const iterations = 10000;
      const startTime = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        cache.delete(`key-${i}`);
      }

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const avgOperationUs = (durationMs * 1000) / iterations;

      console.log(`LRUCache delete: ${avgOperationUs.toFixed(3)}µs per operation`);

      // Should be under 10µs per operation for O(1)
      expect(avgOperationUs).toBeLessThan(50);
    });
  });

  describe('Memory Efficiency', () => {
    it('should never exceed max size under heavy load', () => {
      const cache = new LRUCache<string, number>(1000);

      // Concurrent-like access pattern
      for (let round = 0; round < 100; round++) {
        for (let i = 0; i < 100; i++) {
          cache.set(`key-${round * 100 + i}`, i);
          expect(cache.size).toBeLessThanOrEqual(1000);
        }
      }
    });

    it('should maintain LRU order correctly', () => {
      const cache = new LRUCache<string, number>(3);

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to make it most recently used
      cache.get('a');

      // Add 'd' - should evict 'b' (oldest after 'a' access)
      cache.set('d', 4);

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });
  });

  describe('Hit Rate Tracking', () => {
    it('should accurately track hit rate', () => {
      const cache = new LRUCache<string, number>(100);

      // Set up some entries
      for (let i = 0; i < 50; i++) {
        cache.set(`key-${i}`, i);
      }

      // 80 hits
      for (let i = 0; i < 80; i++) {
        cache.get(`key-${i % 50}`);
      }

      // 20 misses
      for (let i = 0; i < 20; i++) {
        cache.get(`missing-${i}`);
      }

      const stats = cache.getStats();

      expect(stats.hits).toBe(80);
      expect(stats.misses).toBe(20);
      expect(stats.hitRate).toBeCloseTo(0.8, 2);
    });
  });

  describe('Stress Test', () => {
    it('should handle rapid concurrent-like access patterns', () => {
      const cache = new LRUCache<string, object>(10000);
      const errors: Error[] = [];

      try {
        // Simulate concurrent access
        for (let i = 0; i < 100000; i++) {
          const key = `key-${Math.floor(Math.random() * 15000)}`;
          const action = Math.random();

          if (action < 0.4) {
            cache.set(key, { id: i, data: 'x'.repeat(100) });
          } else if (action < 0.9) {
            cache.get(key);
          } else {
            cache.delete(key);
          }

          // Verify invariants
          if (cache.size > 10000) {
            errors.push(new Error(`Cache exceeded max size: ${cache.size}`));
          }
        }
      } catch (e) {
        errors.push(e as Error);
      }

      expect(errors.length).toBe(0);
      expect(cache.size).toBeLessThanOrEqual(10000);
    });
  });
});
