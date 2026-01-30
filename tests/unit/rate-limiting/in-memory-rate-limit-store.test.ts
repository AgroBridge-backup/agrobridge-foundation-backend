import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  describe('incrementWithLimit', () => {
    it('should increment from zero', async () => {
      const result = await store.incrementWithLimit('user1', 10, 60000);
      expect(result.count).toBe(1);
      expect(result.allowed).toBe(true);
    });

    it('should enforce max request limit', async () => {
      const maxRequests = 5;
      for (let i = 0; i < maxRequests; i++) {
        const result = await store.incrementWithLimit('user1', maxRequests, 60000);
        expect(result.allowed).toBe(true);
        expect(result.count).toBe(i + 1);
      }

      const result = await store.incrementWithLimit('user1', maxRequests, 60000);
      expect(result.allowed).toBe(false);
      expect(result.count).toBe(maxRequests);
    });

    it('should reset after time window expires', async () => {
      const timeWindowMs = 50;

      await store.incrementWithLimit('user1', 5, timeWindowMs);
      await store.incrementWithLimit('user1', 5, timeWindowMs);
      await store.incrementWithLimit('user1', 5, timeWindowMs);
      await store.incrementWithLimit('user1', 5, timeWindowMs);
      await store.incrementWithLimit('user1', 5, timeWindowMs);

      const result1 = await store.incrementWithLimit('user1', 5, timeWindowMs);
      expect(result1.allowed).toBe(false);
      expect(result1.count).toBe(5);

      await new Promise((resolve) => setTimeout(resolve, timeWindowMs + 20));

      const result2 = await store.incrementWithLimit('user1', 5, timeWindowMs);
      expect(result2.allowed).toBe(true);
      expect(result2.count).toBe(1);
    });

    it('should handle multiple identifiers independently', async () => {
      const result1 = await store.incrementWithLimit('user1', 5, 60000);
      const result2 = await store.incrementWithLimit('user2', 5, 60000);

      expect(result1.count).toBe(1);
      expect(result1.allowed).toBe(true);
      expect(result2.count).toBe(1);
      expect(result2.allowed).toBe(true);

      const result3 = await store.get('user1');
      const result4 = await store.get('user2');

      expect(result3?.count).toBe(1);
      expect(result4?.count).toBe(1);
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return existing entry', async () => {
      await store.incrementWithLimit('user1', 5, 60000);
      const result = await store.get('user1');

      expect(result).not.toBeNull();
      expect(result?.count).toBe(1);
      expect(result?.resetTime).toBeInstanceOf(Date);
    });
  });

  describe('delete', () => {
    it('should remove entry', async () => {
      await store.incrementWithLimit('user1', 5, 60000);
      const result1 = await store.get('user1');
      expect(result1).not.toBeNull();

      await store.delete('user1');
      const result2 = await store.get('user1');
      expect(result2).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const timeWindowMs = 100;
      await store.incrementWithLimit('user1', 5, timeWindowMs);
      await store.incrementWithLimit('user2', 5, 60000);

      const result1 = await store.get('user1');
      const result2 = await store.get('user2');
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, timeWindowMs + 10));
      store.cleanup();

      const result3 = await store.get('user1');
      const result4 = await store.get('user2');
      expect(result3).toBeNull();
      expect(result4).not.toBeNull();
    });

    it('should not remove active entries', async () => {
      await store.incrementWithLimit('user1', 5, 60000);
      store.cleanup();

      const result = await store.get('user1');
      expect(result).not.toBeNull();
    });
  });
});
