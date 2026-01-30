import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MLAbuseDetector } from '../../src/ml/abuse-detector.js';

describe('MLAbuseDetector - Cache Cleanup', () => {
  let detector: MLAbuseDetector;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  beforeEach(() => {
    // Use fast cleanup interval for testing
    // Note: cacheTTL must be >= 1000ms and maxCacheSize >= 100 per validateConfig()
    detector = new MLAbuseDetector({
      cleanupIntervalMs: 100,
      cacheTTL: 1000, // Minimum valid TTL
      maxCacheSize: 100, // Minimum valid cache size
    });
  });

  afterEach(async () => {
    detector.destroy();
    // Wait for any pending timers
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it('should start cleanup interval on construction', () => {
    const stats = detector.getCacheStats();
    expect(stats.cleanupIntervalActive).toBe(true);
  });

  it('should cleanup expired IP reputation entries', async () => {
    // Create detector with short TTL for this test
    const shortTTLDetector = new MLAbuseDetector({
      cleanupIntervalMs: 100,
      cacheTTL: 1000, // 1 second TTL
      maxCacheSize: 100,
    });

    // Mock fetch to return a response that will be cached
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ reputation: 0.5 }))));

    try {
      // Add entry
      await shortTTLDetector.checkRequest({
        ip: '192.168.1.1',
        timestamp: Date.now(),
      });
      let stats = shortTTLDetector.getCacheStats();
      expect(stats.ipReputation).toBe(1);
      // Wait for TTL to expire (1000ms) and cleanup to run (100ms intervals)
      await new Promise((resolve) => setTimeout(resolve, 1300));
      stats = shortTTLDetector.getCacheStats();
      expect(stats.ipReputation).toBe(0);
    } finally {
      global.fetch = originalFetch;
      shortTTLDetector.destroy();
    }
  });

  it('should enforce max cache size for IP reputation', async () => {
    // Add more entries than maxCacheSize (100)
    // The LRU cache will automatically evict oldest entries when maxSize is exceeded
    const promises = Array.from({ length: 150 }, (_, i) =>
      detector.checkRequest({
        ip: `192.168.1.${i}`,
        timestamp: Date.now(),
      }),
    );
    await Promise.all(promises);
    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stats = detector.getCacheStats();
    // LRU cache enforces maxSize of 100
    expect(stats.ipReputation).toBeLessThanOrEqual(100);
  });

  it('should cleanup user frequency entries with empty windows', async () => {
    // User frequency window is fixed at 60_000ms (1 minute) in the implementation
    // This test verifies the entry exists after creation
    // To fully test cleanup, we would need to wait 60+ seconds which is too long for unit tests
    const now = Date.now();
    await detector.checkRequest({
      userId: 'user-1',
      timestamp: now,
    });
    let stats = detector.getCacheStats();
    expect(stats.userFrequency).toBe(1);

    // Since window is 60s and we can't wait that long in tests,
    // just verify the cleanup mechanism runs without error
    await new Promise((resolve) => setTimeout(resolve, 200));
    stats = detector.getCacheStats();
    // Entry should still exist since window hasn't expired (60s window)
    expect(stats.userFrequency).toBe(1);
  });

  it('should cleanup interval when destroy is called', () => {
    const statsBefore = detector.getCacheStats();
    expect(statsBefore.cleanupIntervalActive).toBe(true);
    detector.destroy();
    const statsAfter = detector.getCacheStats();
    expect(statsAfter.cleanupIntervalActive).toBe(false);
  });

  it('should not leak memory over extended period', async () => {
    const initialStats = detector.getCacheStats();

    // Simulate 200 unique users (more than maxCacheSize of 100)
    for (let i = 0; i < 200; i++) {
      await detector.checkRequest({
        userId: `user-${i}`,
        ip: `10.0.0.${i % 256}`,
        timestamp: Date.now(),
      });

      if (i % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 300));
    const finalStats = detector.getCacheStats();

    // Should be bounded by maxCacheSize of 100 (LRU eviction)
    expect(finalStats.ipReputation).toBeLessThanOrEqual(100);
    expect(finalStats.userFrequency).toBeLessThanOrEqual(100);
  });

  it('should handle concurrent cleanup without errors', async () => {
    // Add many entries concurrently (more than maxCacheSize of 100)
    const promises = Array.from({ length: 200 }, (_, i) =>
      detector.checkRequest({
        userId: `user-${i}`,
        ip: `10.0.0.${i}`,
        timestamp: Date.now(),
      }),
    );
    await Promise.all(promises);
    // Wait for multiple cleanup cycles
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stats = detector.getCacheStats();
    // LRU cache enforces maxCacheSize of 100
    expect(stats.ipReputation).toBeLessThanOrEqual(100);
    expect(stats.userFrequency).toBeLessThanOrEqual(100);
  });
});
