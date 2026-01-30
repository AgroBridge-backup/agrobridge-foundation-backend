import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerEvent,
} from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker<string>;
  const defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 3,
    openDuration: 1000,
    successThreshold: 2,
    timeout: 500,
  };

  beforeEach(() => {
    breaker = new CircuitBreaker<string>(defaultConfig, 'test-service');
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero metrics initially', () => {
      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalFailures).toBe(0);
      expect(metrics.totalTimeouts).toBe(0);
      expect(metrics.totalFallbacks).toBe(0);
      expect(metrics.failureRate).toBe(0);
      expect(metrics.consecutiveSuccesses).toBe(0);
      expect(metrics.consecutiveFailures).toBe(0);
    });

    it('should report healthy status initially', () => {
      const health = breaker.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.degraded).toBe(false);
      expect(health.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Successful Operations', () => {
    it('should execute successful operations', async () => {
      const result = await breaker.execute(async () => 'success');

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.circuitState).toBe(CircuitState.CLOSED);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should track consecutive successes', async () => {
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      const metrics = breaker.getMetrics();
      expect(metrics.consecutiveSuccesses).toBe(3);
      expect(metrics.consecutiveFailures).toBe(0);
    });

    it('should track latency percentiles', async () => {
      for (let i = 0; i < 10; i++) {
        await breaker.execute(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return 'success';
        });
      }

      const metrics = breaker.getMetrics();
      expect(metrics.p50Latency).toBeGreaterThan(0);
      expect(metrics.p95Latency).toBeGreaterThan(0);
      expect(metrics.p99Latency).toBeGreaterThan(0);
      expect(metrics.avgLatency).toBeGreaterThan(0);
    });
  });

  describe('Failure Handling', () => {
    it('should handle failures and return fallback', async () => {
      const result = await breaker.execute(async () => {
        throw new Error('Test error');
      }, 'fallback');

      expect(result.success).toBe(false);
      expect(result.data).toBe('fallback');
      expect(result.error?.message).toBe('Test error');
      expect(result.fromFallback).toBe(true);
    });

    it('should track consecutive failures', async () => {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
      await breaker.execute(async () => {
        throw new Error('fail');
      });

      const metrics = breaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(2);
      expect(metrics.consecutiveSuccesses).toBe(0);
    });

    it('should open circuit after failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reset consecutive failures on success', async () => {
      await breaker.execute(async () => {
        throw new Error('fail');
      });
      await breaker.execute(async () => {
        throw new Error('fail');
      });
      await breaker.execute(async () => 'success');

      const metrics = breaker.getMetrics();
      expect(metrics.consecutiveFailures).toBe(0);
      expect(metrics.consecutiveSuccesses).toBe(1);
    });
  });

  describe('Circuit State Transitions', () => {
    it('should reject immediately when OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      const startTime = Date.now();
      const result = await breaker.execute(async () => 'should not run', 'fallback');
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data).toBe('fallback');
      expect(result.fromFallback).toBe(true);
      expect(duration).toBeLessThan(50);
    });

    it('should transition to HALF_OPEN after openDuration', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      await new Promise((r) => setTimeout(r, 1100));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after successThreshold in HALF_OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      await new Promise((r) => setTimeout(r, 1100));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should re-open circuit on failure in HALF_OPEN', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      await new Promise((r) => setTimeout(r, 1100));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(async () => {
        throw new Error('still failing');
      });

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout slow operations', async () => {
      const result = await breaker.execute(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 'success';
      }, 'timeout-fallback');

      expect(result.success).toBe(false);
      expect(result.data).toBe('timeout-fallback');
      expect(result.error?.message).toContain('timeout');
    });

    it('should track timeouts separately from failures', async () => {
      await breaker.execute(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 'success';
      }, 'fallback');

      const metrics = breaker.getMetrics();
      expect(metrics.totalTimeouts).toBe(1);
      expect(metrics.totalFailures).toBe(1);
    });

    it('should calculate timeout rate correctly', async () => {
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      await breaker.execute(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 'success';
      }, 'fallback');

      const metrics = breaker.getMetrics();
      expect(metrics.timeoutRate).toBeCloseTo(1 / 3, 2);
    });
  });

  describe('Adaptive Timeout', () => {
    it('should use adaptive timeout when enabled', async () => {
      const adaptiveBreaker = new CircuitBreaker<string>(
        {
          ...defaultConfig,
          timeout: 100,
          adaptiveTimeout: {
            enabled: true,
            minTimeout: 50,
            maxTimeout: 2000,
            p99LatencyFactor: 1.5,
          },
        },
        'adaptive-service',
      );

      for (let i = 0; i < 10; i++) {
        await adaptiveBreaker.execute(async () => {
          await new Promise((r) => setTimeout(r, 10));
          return 'success';
        });
      }

      const metrics = adaptiveBreaker.getMetrics();
      expect(metrics.p99Latency).toBeGreaterThan(0);
    });
  });

  describe('Event System', () => {
    it('should emit STATE_CHANGE events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.on((event) => events.push(event));

      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      const stateChangeEvents = events.filter((e) => e.type === 'STATE_CHANGE');
      expect(stateChangeEvents.length).toBeGreaterThan(0);
      expect(stateChangeEvents[0]).toMatchObject({
        type: 'STATE_CHANGE',
        from: CircuitState.CLOSED,
        to: CircuitState.OPEN,
      });
    });

    it('should emit REQUEST_SUCCESS events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.on((event) => events.push(event));

      await breaker.execute(async () => 'success');

      const successEvents = events.filter((e) => e.type === 'REQUEST_SUCCESS');
      expect(successEvents.length).toBe(1);
    });

    it('should emit REQUEST_FAILURE events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.on((event) => events.push(event));

      await breaker.execute(async () => {
        throw new Error('test error');
      });

      const failureEvents = events.filter((e) => e.type === 'REQUEST_FAILURE');
      expect(failureEvents.length).toBe(1);
    });

    it('should emit FALLBACK_USED events', async () => {
      const events: CircuitBreakerEvent[] = [];
      breaker.on((event) => events.push(event));

      await breaker.execute(async () => {
        throw new Error('fail');
      }, 'fallback');

      const fallbackEvents = events.filter((e) => e.type === 'FALLBACK_USED');
      expect(fallbackEvents.length).toBe(1);
    });

    it('should allow unsubscribing from events', async () => {
      const events: CircuitBreakerEvent[] = [];
      const unsubscribe = breaker.on((event) => events.push(event));

      await breaker.execute(async () => 'success');
      expect(events.length).toBe(1);

      unsubscribe();
      await breaker.execute(async () => 'success');
      expect(events.length).toBe(1);
    });
  });

  describe('Fallback Strategies', () => {
    it('should try multiple fallbacks in order', async () => {
      const attempts: string[] = [];

      const result = await breaker.executeWithFallbacks(async () => {
        attempts.push('primary');
        throw new Error('primary failed');
      }, [
        async () => {
          attempts.push('fallback1');
          throw new Error('fallback1 failed');
        },
        async () => {
          attempts.push('fallback2');
          return 'fallback2-success';
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.data).toBe('fallback2-success');
      expect(attempts).toEqual(['primary', 'fallback1', 'fallback2']);
    });

    it('should use final fallback when all strategies fail', async () => {
      const result = await breaker.executeWithFallbacks(
        async () => {
          throw new Error('primary failed');
        },
        [
          async () => {
            throw new Error('fallback1 failed');
          },
        ],
        'final-fallback',
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('final-fallback');
      expect(result.fromFallback).toBe(true);
    });
  });

  describe('Force Operations', () => {
    it('should force open circuit', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      breaker.forceOpen();

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should force close circuit', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.forceClose();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Health Status', () => {
    it('should report healthy when closed', () => {
      const health = breaker.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.degraded).toBe(false);
    });

    it('should report unhealthy when open', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      const health = breaker.getHealthStatus();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain('OPEN');
    });

    it('should report degraded when in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      await new Promise((r) => setTimeout(r, 1100));

      const health = breaker.getHealthStatus();
      expect(health.degraded).toBe(true);
      expect(health.state).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('Reset', () => {
    it('should reset all state', async () => {
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalFailures).toBe(0);
      expect(metrics.consecutiveFailures).toBe(0);
    });
  });

  describe('Sliding Window', () => {
    it('should calculate sliding window failure rate', async () => {
      const windowBreaker = new CircuitBreaker<string>(
        {
          ...defaultConfig,
          slidingWindowMs: 5000,
          minimumRequestThreshold: 5,
        },
        'window-test',
      );

      await windowBreaker.execute(async () => 'success');
      await windowBreaker.execute(async () => 'success');
      await windowBreaker.execute(async () => 'success');
      await windowBreaker.execute(async () => {
        throw new Error('fail');
      });
      await windowBreaker.execute(async () => {
        throw new Error('fail');
      });

      const metrics = windowBreaker.getMetrics();
      expect(metrics.slidingWindowFailureRate).toBeCloseTo(0.4, 1);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent requests correctly', async () => {
      const concurrentBreaker = new CircuitBreaker<string>(
        {
          ...defaultConfig,
          failureThreshold: 50,
        },
        'concurrent-test',
      );

      const promises = Array.from({ length: 100 }, (_, i) =>
        concurrentBreaker.execute(async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          if (i % 4 === 0) throw new Error('fail');
          return `success-${i}`;
        }),
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(100);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      expect(successCount + failureCount).toBe(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined fallback value', async () => {
      const result = await breaker.execute(async () => {
        throw new Error('fail');
      }, undefined);

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.fromFallback).toBe(false);
    });

    it('should handle null fallback value', async () => {
      const nullBreaker = new CircuitBreaker<string | null>(defaultConfig, 'null-test');

      const result = await nullBreaker.execute(async () => {
        throw new Error('fail');
      }, null);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });

    it('should handle very fast operations', async () => {
      const result = await breaker.execute(async () => 'instant');

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeLessThan(50);
    });

    it('should handle operations that throw non-Error objects', async () => {
      const result = await breaker.execute(async () => {
        throw 'string error';
      }, 'fallback');

      expect(result.success).toBe(false);
      expect(result.data).toBe('fallback');
    });

    it('should include trace ID in results', async () => {
      const result = await breaker.execute(async () => 'success');

      expect(result.traceId).toBeDefined();
      expect(typeof result.traceId).toBe('string');
    });
  });
});
