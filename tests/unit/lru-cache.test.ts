import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../../src/utils/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(3);
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should update existing keys', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should delete keys', () => {
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should report has correctly', () => {
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when exceeding max size', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // This should evict 'a'

      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBeUndefined(); // Evicted
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should move accessed items to end (most recently used)', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access 'a' to mark it as recently used
      cache.get('a');

      // Add new item - should evict 'b' (oldest after 'a' was accessed)
      cache.set('d', 4);

      expect(cache.get('a')).toBe(1); // Still present
      expect(cache.get('b')).toBeUndefined(); // Evicted
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should never exceed max size', () => {
      const smallCache = new LRUCache<string, number>(5);

      // Add 100 entries
      for (let i = 0; i < 100; i++) {
        smallCache.set(`key-${i}`, i);
        expect(smallCache.size).toBeLessThanOrEqual(5);
      }

      expect(smallCache.size).toBe(5);
    });

    it('should keep most recently used entries', () => {
      // Add 3 items
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Access in order: a, b, c (c is now most recent)
      cache.get('a');
      cache.get('b');
      cache.get('c');

      // Add 'd' - should evict 'a' (least recently used)
      cache.set('d', 4);

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });
  });

  describe('metrics/stats', () => {
    it('should track hits and misses', () => {
      cache.set('a', 1);

      // Hit
      cache.get('a');
      cache.get('a');

      // Miss
      cache.get('missing');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    });

    it('should return 0 hit rate when no operations', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should reset stats', () => {
      cache.set('a', 1);
      cache.get('a');
      cache.get('missing');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should report correct size in stats', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(3);
    });
  });

  describe('Map interface compatibility', () => {
    it('should iterate with forEach', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const entries: [string, number][] = [];
      cache.forEach((value, key) => {
        entries.push([key, value]);
      });

      expect(entries).toHaveLength(2);
    });

    it('should provide keys iterator', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const keys = Array.from(cache.keys());
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('should provide values iterator', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const values = Array.from(cache.values());
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('should provide entries iterator', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const entries = Array.from(cache.entries());
      expect(entries).toHaveLength(2);
    });

    it('should be iterable with for...of', () => {
      cache.set('a', 1);
      cache.set('b', 2);

      const entries: [string, number][] = [];
      for (const entry of cache) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should throw on invalid max size', () => {
      expect(() => new LRUCache(0)).toThrow();
      expect(() => new LRUCache(-1)).toThrow();
    });

    it('should work with size 1', () => {
      const tinyCache = new LRUCache<string, number>(1);

      tinyCache.set('a', 1);
      expect(tinyCache.get('a')).toBe(1);

      tinyCache.set('b', 2);
      expect(tinyCache.get('a')).toBeUndefined();
      expect(tinyCache.get('b')).toBe(2);
      expect(tinyCache.size).toBe(1);
    });

    it('should handle undefined values correctly', () => {
      const cacheWithUndefined = new LRUCache<string, number | undefined>(3);

      // Note: undefined values are tricky - get returns undefined for both
      // "not found" and "value is undefined"
      cacheWithUndefined.set('a', undefined);
      expect(cacheWithUndefined.has('a')).toBe(true);
    });

    it('should handle concurrent operations', async () => {
      const concurrentCache = new LRUCache<string, number>(100);

      // Simulate concurrent operations
      const promises = Array.from({ length: 1000 }, (_, i) =>
        Promise.resolve().then(() => {
          concurrentCache.set(`key-${i}`, i);
          concurrentCache.get(`key-${Math.floor(Math.random() * i)}`);
        }),
      );

      await Promise.all(promises);

      expect(concurrentCache.size).toBeLessThanOrEqual(100);
    });
  });
});
