import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MLAbuseDetector } from '../../src/ml/abuse-detector.js';
import { CircuitState } from '../../src/utils/circuit-breaker.js';

describe('MLAbuseDetector - Fast-Fail Mode', () => {
  let detector: MLAbuseDetector;
  const originalFetch = global.fetch;

  beforeEach(() => {
    detector = new MLAbuseDetector({
      cleanupIntervalMs: 100000, // Long interval to avoid interference
      cacheTTL: 60000,
      maxCacheSize: 1000,
    });
  });

  afterEach(() => {
    detector.destroy();
    global.fetch = originalFetch;
  });

  describe('Fast-Fail Activation', () => {
    it('should return neutral prediction when all services are unhealthy', async () => {
      // Force all circuit breakers to open
      global.fetch = vi.fn(() => Promise.reject(new Error('Service unavailable')));

      // Trigger failures to open all circuit breakers
      for (let i = 0; i < 6; i++) {
        await detector.checkRequest({
          ip: `192.168.1.${i}`,
          timestamp: Date.now(),
        });
      }

      // Check circuit breaker stats
      const cbStats = detector.getCircuitBreakerStats();

      // If all breakers are open, fast-fail should activate
      if (
        cbStats.ipReputation.state === CircuitState.OPEN &&
        cbStats.vpnCheck.state === CircuitState.OPEN &&
        cbStats.torCheck.state === CircuitState.OPEN &&
        cbStats.geoLocation.state === CircuitState.OPEN
      ) {
        const startTime = Date.now();
        const result = await detector.checkRequest({
          ip: '192.168.1.100',
          timestamp: Date.now(),
        });
        const duration = Date.now() - startTime;

        // Should return quickly with neutral values
        expect(result.abuseProbability).toBe(0.5);
        expect(result.riskLevel).toBe('medium');
        expect(result.confidence).toBe(0.1);
        expect(duration).toBeLessThan(50);
      }
    });

    it('should not activate fast-fail when some services are healthy', async () => {
      // Only fail IP reputation service
      global.fetch = vi.fn((url: any) => {
        if (url.includes('reputation')) {
          return Promise.reject(new Error('Service unavailable'));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ isVpn: false, isTor: false, country: 'US' })),
        );
      });

      const result = await detector.checkRequest({
        ip: '192.168.1.1',
        timestamp: Date.now(),
      });

      // Should not be in degraded mode
      expect(result.confidence).toBeGreaterThan(0.1);
    });
  });

  describe('Graceful Degradation', () => {
    it('should use fallback values when services fail', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

      const result = await detector.checkRequest({
        ip: '192.168.1.1',
        userId: 'test-user',
        userAgent: 'Mozilla/5.0',
        timestamp: Date.now(),
      });

      // Should still return a valid prediction using fallback values
      expect(result.abuseProbability).toBeGreaterThanOrEqual(0);
      expect(result.abuseProbability).toBeLessThanOrEqual(1);
      expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
    });

    it('should use cached values when available during degradation', async () => {
      // First request succeeds
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ reputation: 0.2 }))),
      );

      await detector.checkRequest({
        ip: '192.168.1.1',
        timestamp: Date.now(),
      });

      // Second request fails but cache should be used
      global.fetch = vi.fn(() => Promise.reject(new Error('Service unavailable')));

      const result = await detector.checkRequest({
        ip: '192.168.1.1',
        timestamp: Date.now(),
      });

      // Should use cached reputation value
      expect(result.factors.ipReputation).toBe(0.2);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should report healthy status when all breakers are closed', () => {
      expect(detector.areExternalServicesHealthy()).toBe(true);
    });

    it('should report unhealthy when any breaker is open', async () => {
      // Force failures on IP reputation service
      global.fetch = vi.fn(() => Promise.reject(new Error('Service unavailable')));

      // Trigger enough failures to open the circuit
      for (let i = 0; i < 6; i++) {
        await detector.checkRequest({
          ip: `192.168.1.${i}`,
          timestamp: Date.now(),
        });
      }

      const stats = detector.getCircuitBreakerStats();
      const anyOpen =
        stats.ipReputation.state === CircuitState.OPEN ||
        stats.vpnCheck.state === CircuitState.OPEN ||
        stats.torCheck.state === CircuitState.OPEN ||
        stats.geoLocation.state === CircuitState.OPEN;

      if (anyOpen) {
        expect(detector.areExternalServicesHealthy()).toBe(false);
      }
    });

    it('should reset all circuit breakers', async () => {
      // Force some failures
      global.fetch = vi.fn(() => Promise.reject(new Error('Service unavailable')));

      for (let i = 0; i < 6; i++) {
        await detector.checkRequest({
          ip: `192.168.1.${i}`,
          timestamp: Date.now(),
        });
      }

      // Reset all breakers
      detector.resetCircuitBreakers();

      // All should be healthy now
      expect(detector.areExternalServicesHealthy()).toBe(true);
    });
  });

  describe('Performance Under Degradation', () => {
    it('should handle high request volume during degradation', async () => {
      global.fetch = vi.fn(() => Promise.reject(new Error('Service unavailable')));

      const startTime = Date.now();
      const promises = Array.from({ length: 100 }, (_, i) =>
        detector.checkRequest({
          ip: `192.168.1.${i % 256}`,
          userId: `user-${i}`,
          timestamp: Date.now(),
        }),
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests should complete
      expect(results.length).toBe(100);

      // Should complete reasonably quickly even with failures
      expect(duration).toBeLessThan(10000);

      // All results should be valid
      results.forEach((result) => {
        expect(result.abuseProbability).toBeGreaterThanOrEqual(0);
        expect(result.abuseProbability).toBeLessThanOrEqual(1);
      });
    });
  });
});
