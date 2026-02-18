import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoginRateLimiter, LoginRateLimiterConfig } from '../../../src/rate-limiting/login-rate-limiter';

/**
 * Concurrent rate limiter tests
 * 
 * These tests verify that the LoginRateLimiter correctly handles concurrent requests
 * without TOCTOU (Time-of-Check-Time-of-Use) race conditions.
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

describe('LoginRateLimiter - Concurrent Operations', () => {
  let limiter: LoginRateLimiter;
  const config: LoginRateLimiterConfig = {
    maxAttempts: 5,
    windowMs: 60000, // 1 minute
    blockDurationMs: 300000, // 5 minutes
  };

  beforeEach(() => {
    limiter = new LoginRateLimiter(config);
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('TOCTOU Vulnerability Prevention', () => {
    it('should prevent 100 concurrent login attempts from bypassing the limit', async () => {
      const ip = '192.168.1.1';
      const concurrentRequests = 100;
      
      // Simulate 100 concurrent failed login attempts
      const promises = Array.from({ length: concurrentRequests }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const results = await Promise.all(promises);
      
      // Count how many were allowed vs blocked
      const allowedCount = results.filter(r => r.allowed).length;
      const blockedCount = results.filter(r => !r.allowed).length;
      
      // With atomic operations, maxAttempts-1 should be allowed (5th triggers block)
      // The limiter blocks ON the maxAttempts-th attempt, not after it
      expect(allowedCount).toBe(config.maxAttempts - 1);
      expect(blockedCount).toBe(concurrentRequests - (config.maxAttempts - 1));
      
      // Verify total attempts recorded
      const finalCheck = await limiter.checkAndRecord(ip, false);
      expect(finalCheck.totalAttempts).toBeGreaterThanOrEqual(config.maxAttempts);
    });

    it('should handle concurrent mixed check and record operations', async () => {
      const ip = '192.168.1.2';
      
      // Mix of check-only and record operations
      const operations = [
        ...Array(10).fill(null).map(() => limiter.checkAndRecord(ip, false)), // Just checks
        ...Array(10).fill(null).map(() => limiter.checkAndRecord(ip, true)),  // Record failures
      ];
      
      const results = await Promise.all(operations);
      
      // All checks should have been allowed (no prior failures)
      const checkResults = results.slice(0, 10);
      expect(checkResults.every(r => r.allowed)).toBe(true);
      
      // Some records should be blocked after maxAttempts
      const recordResults = results.slice(10);
      const allowedRecords = recordResults.filter(r => r.allowed).length;
      expect(allowedRecords).toBeLessThanOrEqual(config.maxAttempts);
    });

    it('should maintain consistency under high concurrency from multiple IPs', async () => {
      const ips = Array.from({ length: 10 }, (_, i) => `192.168.1.${i + 10}`);
      const requestsPerIp = 20;
      
      // Create concurrent requests across multiple IPs
      const allPromises: Promise<any>[] = [];
      
      for (const ip of ips) {
        for (let i = 0; i < requestsPerIp; i++) {
          allPromises.push(limiter.checkAndRecord(ip, true));
        }
      }
      
      const results = await Promise.all(allPromises);
      
      // Group results by IP (we need to track which result belongs to which IP)
      // Since we can't easily map results back to IPs in this test structure,
      // we'll verify aggregate properties
      
      const totalAllowed = results.filter(r => r.allowed).length;
      const totalBlocked = results.filter(r => !r.allowed).length;
      
      // Each IP should have at most maxAttempts allowed
      // Total allowed should be at most ips.length * maxAttempts
      expect(totalAllowed).toBeLessThanOrEqual(ips.length * config.maxAttempts);
      expect(totalAllowed + totalBlocked).toBe(ips.length * requestsPerIp);
    });
  });

  describe('Atomic Operation Guarantees', () => {
    it('should never allow more attempts than maxAttempts in a sliding window', async () => {
      const ip = '192.168.1.3';
      
      // Sequential requests to establish baseline
      // First 4 should be allowed (5th triggers block)
      for (let i = 0; i < config.maxAttempts - 1; i++) {
        const result = await limiter.checkAndRecord(ip, true);
        expect(result.allowed).toBe(true);
      }
      
      // 5th attempt should trigger block
      const fifthResult = await limiter.checkAndRecord(ip, true);
      expect(fifthResult.allowed).toBe(false);
      
      // Subsequent request should also be blocked
      const blockedResult = await limiter.checkAndRecord(ip, true);
      expect(blockedResult.allowed).toBe(false);
      
      // Verify with concurrent burst
      const burstPromises = Array.from({ length: 50 }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const burstResults = await Promise.all(burstPromises);
      const allowedInBurst = burstResults.filter(r => r.allowed).length;
      
      // No additional requests should be allowed during the burst
      expect(allowedInBurst).toBe(0);
    });

    it('should correctly track attemptsRemaining under concurrency', async () => {
      const ip = '192.168.1.4';
      const concurrentRequests = 10;
      
      const promises = Array.from({ length: concurrentRequests }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const results = await Promise.all(promises);
      
      // Check that attemptsRemaining is consistent
      // The sum of attemptsRemaining for allowed requests should make sense
      const allowedResults = results.filter(r => r.allowed);
      
      // Each allowed request should show decremented remaining count
      const remainingValues = allowedResults.map(r => r.attemptsRemaining);
      expect(Math.max(...remainingValues)).toBeLessThan(config.maxAttempts);
      expect(Math.min(...remainingValues)).toBeGreaterThanOrEqual(0);
    });

    it('should handle rapid sequential and concurrent mixed operations', async () => {
      const ip = '192.168.1.5';
      
      // First, some sequential failures
      for (let i = 0; i < 3; i++) {
        await limiter.checkAndRecord(ip, true);
      }
      
      // Then a concurrent burst
      const burstPromises = Array.from({ length: 20 }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const burstResults = await Promise.all(burstPromises);
      const allowedInBurst = burstResults.filter(r => r.allowed).length;
      
      // First 4 allowed total, already used 3, so 1 more allowed (4th)
      // 5th will trigger block, so only 1 more should be allowed
      expect(allowedInBurst).toBeLessThanOrEqual(1);
    });
  });

  describe('Block Duration Enforcement', () => {
    it('should enforce block duration atomically across concurrent requests', async () => {
      const ip = '192.168.1.6';
      
      // Exhaust the limit
      for (let i = 0; i < config.maxAttempts; i++) {
        await limiter.checkAndRecord(ip, true);
      }
      
      // Verify blocked
      const checkBlocked = await limiter.checkAndRecord(ip, false);
      expect(checkBlocked.allowed).toBe(false);
      expect(checkBlocked.retryAfterMs).toBeGreaterThan(0);
      
      // Concurrent requests while blocked should all be rejected
      const concurrentBlocked = Array.from({ length: 50 }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const blockedResults = await Promise.all(concurrentBlocked);
      expect(blockedResults.every(r => !r.allowed)).toBe(true);
      expect(blockedResults.every(r => r.retryAfterMs > 0)).toBe(true);
    });

    it('should reset block after blockDuration expires', async () => {
      const shortConfig: LoginRateLimiterConfig = {
        maxAttempts: 2,
        windowMs: 1000,
        blockDurationMs: 100, // Very short for testing
      };
      
      const shortLimiter = new LoginRateLimiter(shortConfig);
      const ip = '192.168.1.7';
      
      try {
        // Exhaust limit
        await shortLimiter.checkAndRecord(ip, true);
        await shortLimiter.checkAndRecord(ip, true);
        
        // Should be blocked
        const blocked = await shortLimiter.checkAndRecord(ip, false);
        expect(blocked.allowed).toBe(false);
        
        // Wait for block to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Should be allowed again
        const unblocked = await shortLimiter.checkAndRecord(ip, false);
        expect(unblocked.allowed).toBe(true);
      } finally {
        shortLimiter.destroy();
      }
    });
  });

  describe('Reset and Cleanup Operations', () => {
    it('should handle reset during concurrent operations', async () => {
      const ip = '192.168.1.8';
      
      // Start some operations
      const operations = Array.from({ length: 20 }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      // Reset in the middle (this creates a race condition scenario)
      const resetPromise = limiter.resetForIp(ip);
      
      // Wait for everything to complete
      await Promise.all([...operations, resetPromise]);
      
      // After reset, should be able to make full attempts again
      const freshStart = await limiter.checkAndRecord(ip, false);
      expect(freshStart.allowed).toBe(true);
      expect(freshStart.attemptsRemaining).toBe(config.maxAttempts);
    });

    it('should correctly report stats under concurrent load', async () => {
      const ips = Array.from({ length: 5 }, (_, i) => `192.168.1.${i + 20}`);
      
      // Create load
      const loadPromises: Promise<any>[] = [];
      for (const ip of ips) {
        for (let i = 0; i < config.maxAttempts + 2; i++) {
          loadPromises.push(limiter.checkAndRecord(ip, true));
        }
      }
      
      await Promise.all(loadPromises);
      
      // Check stats
      const stats = limiter.getStats();
      expect(stats.totalTrackedIps).toBeGreaterThan(0);
      expect(stats.currentlyBlockedIps).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Stress Tests', () => {
    it('should handle 1000 concurrent requests from the same IP', async () => {
      const ip = '192.168.1.100';
      const requestCount = 1000;
      
      const promises = Array.from({ length: requestCount }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      const results = await Promise.all(promises);
      
      const allowedCount = results.filter(r => r.allowed).length;
      const blockedCount = results.filter(r => !r.allowed).length;
      
      // maxAttempts-1 should be allowed (maxAttempts-th triggers block)
      expect(allowedCount).toBe(config.maxAttempts - 1);
      expect(blockedCount).toBe(requestCount - (config.maxAttempts - 1));
      
      // Verify final state
      const finalCheck = await limiter.checkAndRecord(ip, false);
      expect(finalCheck.allowed).toBe(false);
      expect(finalCheck.totalAttempts).toBeGreaterThanOrEqual(config.maxAttempts);
    });

    it('should handle concurrent requests from 100 different IPs', async () => {
      const ips = Array.from({ length: 100 }, (_, i) => `10.0.0.${i}`);
      const requestsPerIp = 10;
      
      const allPromises: Promise<any>[] = [];
      
      for (const ip of ips) {
        for (let i = 0; i < requestsPerIp; i++) {
          allPromises.push(limiter.checkAndRecord(ip, true));
        }
      }
      
      const results = await Promise.all(allPromises);
      
      // All should succeed (each IP has its own limit)
      // Each IP allows maxAttempts-1 before blocking on maxAttempts-th
      const allowedCount = results.filter(r => r.allowed).length;
      expect(allowedCount).toBe(ips.length * Math.min(requestsPerIp, config.maxAttempts - 1));
    });

    it('should handle check-only operations during high write concurrency', async () => {
      const ip = '192.168.1.9';
      
      // Start recording failures
      const writePromises = Array.from({ length: 20 }, () => 
        limiter.checkAndRecord(ip, true)
      );
      
      // Concurrently do read-only checks
      const readPromises = Array.from({ length: 50 }, () => 
        limiter.checkAndRecord(ip, false)
      );
      
      const allResults = await Promise.all([...writePromises, ...readPromises]);
      
      // Writes should be limited
      const writeResults = allResults.slice(0, 20);
      const allowedWrites = writeResults.filter(r => r.allowed).length;
      expect(allowedWrites).toBeLessThanOrEqual(config.maxAttempts);
      
      // Reads should reflect the current state
      const readResults = allResults.slice(20);
      // At least some reads should show blocked status once limit is hit
      const blockedReads = readResults.filter(r => !r.allowed).length;
      expect(blockedReads).toBeGreaterThan(0);
    });

    it('should maintain consistency with interleaved check and record operations', async () => {
      const ip = '192.168.1.10';
      const operations: Promise<any>[] = [];
      
      // Create a pattern: check, record, check, record, etc.
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          operations.push(limiter.checkAndRecord(ip, false));
        } else {
          operations.push(limiter.checkAndRecord(ip, true));
        }
      }
      
      const results = await Promise.all(operations);
      
      // Analyze the pattern
      let allowedChecks = 0;
      let allowedRecords = 0;
      
      for (let i = 0; i < results.length; i++) {
        if (i % 2 === 0) {
          if (results[i].allowed) allowedChecks++;
        } else {
          if (results[i].allowed) allowedRecords++;
        }
      }
      
      // Records should be limited
      expect(allowedRecords).toBeLessThanOrEqual(config.maxAttempts);
      
      // Later checks should reflect the recorded attempts
      const laterChecks = results.slice(config.maxAttempts * 2);
      expect(laterChecks.every(r => !r.allowed)).toBe(true);
    });
  });

  describe('Deprecated Method Behavior', () => {
    it('should still work with deprecated checkLimit method (single-threaded)', () => {
      const ip = '192.168.1.200';
      
      // Deprecated method should still function (but with warnings)
      const result1 = limiter.checkLimit(ip);
      expect(result1.allowed).toBe(true);
      
      limiter.recordFailedAttempt(ip);
      
      const result2 = limiter.checkLimit(ip);
      expect(result2.totalAttempts).toBe(1);
    });

    it('should demonstrate TOCTOU vulnerability with deprecated methods', async () => {
      const ip = '192.168.1.201';
      const concurrentRequests = 50;
      
      // Simulate the old vulnerable pattern: check then record
      const vulnerableOperations = Array.from({ length: concurrentRequests }, async () => {
        const check = limiter.checkLimit(ip);
        if (check.allowed) {
          // In a real scenario, the login would happen here
          // Then record the failure
          limiter.recordFailedAttempt(ip);
        }
        return check;
      });
      
      const results = await Promise.all(vulnerableOperations);
      
      // With the deprecated methods, more than maxAttempts might appear allowed
      // due to the race condition (this is the vulnerability)
      const allowedCount = results.filter(r => r.allowed).length;
      
      // This test documents the vulnerability - with the old pattern,
      // the allowed count could exceed maxAttempts due to race conditions
      console.log(`Deprecated method allowed count: ${allowedCount} (vulnerability demo)`);
      
      // The deprecated methods are NOT atomic, so this is expected behavior
      // (which is why they are deprecated)
    });
  });
});

describe('LoginRateLimiter - Metrics and Observability', () => {
  let limiter: LoginRateLimiter;
  const config: LoginRateLimiterConfig = {
    maxAttempts: 3,
    windowMs: 60000,
    blockDurationMs: 300000,
  };

  beforeEach(() => {
    limiter = new LoginRateLimiter(config);
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('should provide race condition metrics', () => {
    const metrics = limiter.getRaceConditionMetrics();
    
    expect(metrics).toHaveProperty('totalDetected');
    expect(metrics).toHaveProperty('detectionMethods');
    expect(metrics.detectionMethods).toHaveProperty('redis_fallback');
    expect(metrics.detectionMethods).toHaveProperty('blocked_record_attempt');
  });

  it('should provide accurate stats', async () => {
    const ip1 = '192.168.1.50';
    const ip2 = '192.168.1.51';
    
    // Exhaust ip1
    for (let i = 0; i < config.maxAttempts; i++) {
      await limiter.checkAndRecord(ip1, true);
    }
    
    // Partial usage of ip2
    await limiter.checkAndRecord(ip2, true);
    
    const stats = limiter.getStats();
    expect(stats.totalTrackedIps).toBe(2);
    expect(stats.currentlyBlockedIps).toBe(1);
  });
});
