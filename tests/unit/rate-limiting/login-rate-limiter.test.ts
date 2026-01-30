import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoginRateLimiter } from '../../../src/rate-limiting/login-rate-limiter.js';

describe('LoginRateLimiter', () => {
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    limiter = new LoginRateLimiter({
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 15 * 60 * 1000,
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('checkLimit', () => {
    it('should allow first request from new IP', () => {
      const result = limiter.checkLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(5);
      expect(result.totalAttempts).toBe(0);
    });

    it('should track attempts and decrement remaining', () => {
      const ip = '192.168.1.2';

      limiter.recordFailedAttempt(ip);
      const result = limiter.checkLimit(ip);

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(4);
      expect(result.totalAttempts).toBe(1);
    });

    it('should block IP after max attempts exceeded', () => {
      const ip = '192.168.1.3';

      // Record 5 failed attempts
      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(ip);
      }

      const result = limiter.checkLimit(ip);

      expect(result.allowed).toBe(false);
      expect(result.attemptsRemaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should isolate tracking between different IPs', () => {
      const ip1 = '192.168.1.4';
      const ip2 = '192.168.1.5';

      // Exhaust ip1
      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(ip1);
      }

      const result1 = limiter.checkLimit(ip1);
      const result2 = limiter.checkLimit(ip2);

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);
      expect(result2.attemptsRemaining).toBe(5);
    });
  });

  describe('recordFailedAttempt', () => {
    it('should increment attempt count', () => {
      const ip = '192.168.1.6';

      limiter.recordFailedAttempt(ip);
      limiter.recordFailedAttempt(ip);

      const result = limiter.checkLimit(ip);
      expect(result.totalAttempts).toBe(2);
    });

    it('should block after threshold', () => {
      const ip = '192.168.1.7';

      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(ip);
      }

      const result = limiter.checkLimit(ip);
      expect(result.allowed).toBe(false);
    });
  });

  describe('resetForIp', () => {
    it('should clear all tracking for an IP', () => {
      const ip = '192.168.1.8';

      // Record some attempts
      for (let i = 0; i < 3; i++) {
        limiter.recordFailedAttempt(ip);
      }

      // Verify attempts recorded
      expect(limiter.checkLimit(ip).totalAttempts).toBe(3);

      // Reset
      limiter.resetForIp(ip);

      // Verify cleared
      const result = limiter.checkLimit(ip);
      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(5);
      expect(result.totalAttempts).toBe(0);
    });

    it('should unblock a blocked IP', () => {
      const ip = '192.168.1.9';

      // Block the IP
      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(ip);
      }
      expect(limiter.checkLimit(ip).allowed).toBe(false);

      // Reset
      limiter.resetForIp(ip);

      // Should be allowed again
      expect(limiter.checkLimit(ip).allowed).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      // Block one IP
      const blockedIp = '192.168.1.10';
      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(blockedIp);
      }

      // Partial attempts on another IP
      limiter.recordFailedAttempt('192.168.1.11');

      const stats = limiter.getStats();

      expect(stats.totalTrackedIps).toBe(2);
      expect(stats.currentlyBlockedIps).toBe(1);
    });
  });

  describe('window expiration', () => {
    it('should clear old attempts after window expires', () => {
      vi.useFakeTimers();
      const ip = '192.168.1.12';

      // Record attempts
      for (let i = 0; i < 3; i++) {
        limiter.recordFailedAttempt(ip);
      }

      // Advance time past window
      vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes

      const result = limiter.checkLimit(ip);

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(5);
      expect(result.totalAttempts).toBe(0);

      vi.useRealTimers();
    });

    it('should unblock IP after block duration expires', () => {
      vi.useFakeTimers();
      const ip = '192.168.1.13';

      // Block the IP
      for (let i = 0; i < 5; i++) {
        limiter.recordFailedAttempt(ip);
      }
      expect(limiter.checkLimit(ip).allowed).toBe(false);

      // Advance time past block duration
      vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes

      // Should be allowed again
      const result = limiter.checkLimit(ip);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('edge cases', () => {
    it('should handle rapid sequential requests', () => {
      const ip = '192.168.1.14';

      // Rapid fire requests
      for (let i = 0; i < 10; i++) {
        limiter.recordFailedAttempt(ip);
      }

      const result = limiter.checkLimit(ip);
      expect(result.allowed).toBe(false);
    });

    it('should handle unknown IP gracefully', () => {
      const result = limiter.checkLimit('unknown');
      expect(result.allowed).toBe(true);
    });

    it('should handle empty string IP', () => {
      const result = limiter.checkLimit('');
      expect(result.allowed).toBe(true);
    });
  });
});
