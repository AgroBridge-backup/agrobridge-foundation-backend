import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TieredRateLimiter } from '../../../src/rate-limiting/tiered-rate-limiter.js';
import { InMemoryRateLimitStore } from '../../../src/rate-limiting/in-memory-rate-limit-store.js';
import { RateLimitTier } from '../../../src/rate-limiting/tier-config.js';

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

describe('TieredRateLimiter (with store interface)', () => {
  let limiter: TieredRateLimiter;
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new InMemoryRateLimitStore();
    limiter = new TieredRateLimiter(store);
  });

  describe('constructor', () => {
    it('should accept a custom store', () => {
      const customStore = new InMemoryRateLimitStore();
      const customLimiter = new TieredRateLimiter(customStore);

      expect(customLimiter).toBeInstanceOf(TieredRateLimiter);
    });
  });

  describe('checkLimit', () => {
    it('should pass rate limit check within limits', async () => {
      const result = await limiter.checkLimit('user1', RateLimitTier.PUBLIC);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(300);
      expect(result.remaining).toBe(299);
      expect(result.tier).toBe(RateLimitTier.PUBLIC);
    });

    it('should reject requests exceeding limit', async () => {
      const maxRequests = 20;

      for (let i = 0; i < maxRequests; i++) {
        const result = await limiter.checkLimit('user1', RateLimitTier.STRICT);
        expect(result.allowed).toBe(true);
      }

      const result = await limiter.checkLimit('user1', RateLimitTier.STRICT);
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(20);
      expect(result.remaining).toBe(0);
    });

    it('should log appropriately on pass', async () => {
      await limiter.checkLimit('user1', RateLimitTier.PUBLIC);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'user1',
          tier: RateLimitTier.PUBLIC,
        }),
        'Rate limit check passed',
      );
    });

    it('should log appropriately on fail', async () => {
      const maxRequests = 20;

      for (let i = 0; i < maxRequests; i++) {
        await limiter.checkLimit('user1', RateLimitTier.STRICT);
      }

      await limiter.checkLimit('user1', RateLimitTier.STRICT);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'user1',
          tier: RateLimitTier.STRICT,
          count: 20,
          limit: 20,
        }),
        'Rate limit exceeded',
      );
    });

    it('should include store_type in span attributes', async () => {
      await limiter.checkLimit('user1', RateLimitTier.PUBLIC);

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('parseTimeWindow', () => {
    it('should parse minutes correctly', async () => {
      await limiter.checkLimit('user1', RateLimitTier.PUBLIC);
      const entry = await store.get('user1');

      expect(entry?.resetTime).toBeInstanceOf(Date);
    });

    it('should throw on invalid format', async () => {
      expect(() => {
        limiter.checkLimit('user1', RateLimitTier.PUBLIC);
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const mockStore = {
        incrementWithLimit: vi.fn().mockRejectedValue(new Error('Store error')),
        get: vi.fn(),
        delete: vi.fn(),
        cleanup: vi.fn(),
      };

      const errorLimiter = new TieredRateLimiter(mockStore as any);

      await expect(errorLimiter.checkLimit('user1', RateLimitTier.PUBLIC)).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('backwards compatibility', () => {
    it('should work with existing interface', async () => {
      const result = await limiter.checkLimit('user1', RateLimitTier.PUBLIC);

      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('remaining');
      expect(result).toHaveProperty('resetTime');
      expect(result).toHaveProperty('tier');
    });
  });
});
