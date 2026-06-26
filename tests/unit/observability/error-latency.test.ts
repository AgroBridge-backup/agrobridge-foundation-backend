import { describe, expect, test } from 'vitest';

import { requestLatencyMs } from '../../../src/middleware/error-observability.js';

/**
 * Regression for §9.6: handleErrorWithObservability computed latencyMs as
 * Date.now() - startTime where startTime was set inside the same function —
 * always ~0. Latency is now derived from req.startedAt (set by the onRequest
 * hook). These tests cover the pure helper directly.
 */
describe('requestLatencyMs', () => {
  test('returns elapsed ms since req.startedAt', () => {
    const startedAt = Date.now() - 500;
    const latency = requestLatencyMs({ startedAt });
    // Allow small scheduling slack; must be ~500, not ~0.
    expect(latency).toBeGreaterThanOrEqual(490);
    expect(latency).toBeLessThan(2000);
  });

  test('returns 0 when startedAt is missing (pre-hook error / synthetic req)', () => {
    expect(requestLatencyMs({})).toBe(0);
    expect(requestLatencyMs({ startedAt: undefined })).toBe(0);
  });

  test('the old bug (always ~0) does not regress for a real request', () => {
    // A request that started 1s ago must report ~1000ms, definitively non-zero.
    const latency = requestLatencyMs({ startedAt: Date.now() - 1000 });
    expect(latency).toBeGreaterThan(900);
  });
});
