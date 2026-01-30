import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MLAbuseDetector } from '../../src/ml/abuse-detector.js';

describe('MLAbuseDetector - Timeouts', () => {
  let detector: MLAbuseDetector;
  const originalFetch = global.fetch;

  beforeEach(() => {
    detector = new MLAbuseDetector({
      cleanupIntervalMs: 100,
    });
  });

  afterEach(() => {
    detector.destroy();
    global.fetch = originalFetch;
  });

  it('should timeout after 1 second for IP reputation', async () => {
    const startTime = Date.now();

    // Mock slow fetch
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify({ reputation: 0.5 })));
          }, 2000); // 2 second delay
        }),
    );

    const result = await detector.checkRequest({
      ip: '192.168.1.1',
      timestamp: Date.now(),
    });
    const duration = Date.now() - startTime;

    // Should complete in ~1 second (timeout) + small overhead
    expect(duration).toBeLessThan(1500);

    // Should return a valid result with default value
    expect(result.abuseProbability).toBeGreaterThanOrEqual(0);
    expect(result.abuseProbability).toBeLessThanOrEqual(1);
  });

  it('should timeout VPN check and return false', async () => {
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify({ isVpn: true })));
          }, 2000);
        }),
    );

    const result = await detector.checkRequest({
      ip: '192.168.1.1',
      timestamp: Date.now(),
    });

    const factors = result.factors;
    // Should return false (0) on timeout
    expect(factors.isVpn).toBe(0);
  });

  it('should handle mixed timeouts successfully', async () => {
    let callCount = 0;

    global.fetch = vi.fn((url: any) => {
      callCount++;

      if (url.includes('reputation')) {
        // Slow: timeout
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify({ reputation: 0.5 })));
          }, 2000);
        });
      } else if (url.includes('vpn')) {
        // Fast
        return Promise.resolve(new Response(JSON.stringify({ isVpn: false })));
      } else {
        // Fast
        return Promise.resolve(new Response(JSON.stringify({ country: 'US' })));
      }
    });

    const startTime = Date.now();
    const result = await detector.checkRequest({
      ip: '192.168.1.1',
      userId: 'test-user',
      userAgent: 'test-agent',
      url: '/api/test',
      method: 'GET',
      timestamp: Date.now(),
    });
    const duration = Date.now() - startTime;

    // Should complete within timeout + small overhead
    expect(duration).toBeLessThan(1500);

    // Should have called all services
    expect(callCount).toBeGreaterThan(0);

    // Should return a valid result
    expect(result.abuseProbability).toBeGreaterThanOrEqual(0);
    expect(result.abuseProbability).toBeLessThanOrEqual(1);
  });
});
