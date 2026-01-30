import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { RedisRateLimitStore } from '../../../src/rate-limiting/redis-rate-limit-store.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';

const mockRedisClient = {
  eval: vi.fn(),
  hGetAll: vi.fn(),
  del: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../../src/observability/request-context.js', () => ({
  requestContext: {
    getLog: () => mockLogger,
  },
}));

describe('RedisRateLimitStore', () => {
  let store: RedisRateLimitStore;
  let fallback: InMemoryRateLimitStore;

  beforeEach(() => {
    vi.clearAllMocks();
    fallback = new InMemoryRateLimitStore();
    store = new RedisRateLimitStore(mockRedisClient as any, fallback);
  });

  describe('incrementWithLimit', () => {
    it('should increment rate limit counter', async () => {
      (mockRedisClient.eval as Mock).mockResolvedValue([1, 1, 10, Date.now() + 60000]);

      const result = await store.incrementWithLimit('user1', 10, 60000);

      expect(result.count).toBe(1);
      expect(result.allowed).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
    });

    it('should enforce max request limit', async () => {
      (mockRedisClient.eval as Mock)
        .mockResolvedValueOnce([1, 1, 5, Date.now() + 60000])
        .mockResolvedValueOnce([1, 2, 5, Date.now() + 60000])
        .mockResolvedValueOnce([1, 3, 5, Date.now() + 60000])
        .mockResolvedValueOnce([1, 4, 5, Date.now() + 60000])
        .mockResolvedValueOnce([1, 5, 5, Date.now() + 60000])
        .mockResolvedValueOnce([0, 5, 5, Date.now() + 60000]);

      for (let i = 0; i < 5; i++) {
        const result = await store.incrementWithLimit('user1', 5, 60000);
        expect(result.allowed).toBe(true);
      }

      const result = await store.incrementWithLimit('user1', 5, 60000);
      expect(result.allowed).toBe(false);
      expect(result.count).toBe(5);
    });

    it('should fallback to in-memory on Redis error', async () => {
      (mockRedisClient.eval as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const result = await store.incrementWithLimit('user1', 10, 60000);

      expect(result.count).toBe(1);
      expect(result.allowed).toBe(true);
      expect(store.didFallback()).toBe(true);
    });

    it('should handle concurrent requests atomically', async () => {
      const now = Date.now();
      (mockRedisClient.eval as Mock).mockResolvedValue([1, 1, 10, now + 60000]);

      const promises = Array.from({ length: 10 }, () =>
        store.incrementWithLimit('user1', 10, 60000),
      );

      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result.allowed).toBe(true);
        expect(result.count).toBe(1);
      });

      expect(mockRedisClient.eval).toHaveBeenCalledTimes(10);
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      (mockRedisClient.hGetAll as Mock).mockResolvedValue({});

      const result = await store.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should return existing entry', async () => {
      const now = Date.now();
      (mockRedisClient.hGetAll as Mock).mockResolvedValue({
        count: '5',
        resetTime: (now + 60000).toString(),
      });

      const result = await store.get('user1');

      expect(result).not.toBeNull();
      expect(result?.count).toBe(5);
      expect(result?.resetTime).toBeInstanceOf(Date);
    });

    it('should fallback on Redis error', async () => {
      (mockRedisClient.hGetAll as Mock).mockRejectedValue(new Error('Redis error'));

      const result = await store.get('user1');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove entry from Redis', async () => {
      (mockRedisClient.del as Mock).mockResolvedValue(1);

      await store.delete('user1');

      expect(mockRedisClient.del).toHaveBeenCalledWith('ratelimit:user1');
    });

    it('should fallback on Redis error', async () => {
      (mockRedisClient.del as Mock).mockRejectedValue(new Error('Redis error'));

      await expect(store.delete('user1')).resolves.not.toThrow();
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      (mockRedisClient.eval as Mock).mockRejectedValue(new Error('Redis error'));

      for (let i = 0; i < 6; i++) {
        await store.incrementWithLimit('user1', 10, 60000);
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          failureCount: 5,
        }),
        'Circuit breaker opened due to consecutive failures',
      );
    });

    it('should use fallback while circuit is open', async () => {
      (mockRedisClient.eval as Mock).mockRejectedValue(new Error('Redis error'));

      for (let i = 0; i < 10; i++) {
        await store.incrementWithLimit('user1', 10, 60000);
      }

      expect(mockRedisClient.eval).toHaveBeenCalledTimes(5);
    });
  });

  describe('cleanup', () => {
    it('should cleanup fallback store', async () => {
      await store.cleanup();

      expect(fallback).toBeDefined();
    });
  });
});
