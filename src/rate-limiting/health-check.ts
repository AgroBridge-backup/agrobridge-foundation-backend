import { RateLimitStore } from '../rate-limiting/rate-limit-store.js';

export interface RateLimitHealthStatus {
  healthy: boolean;
  storeType: 'redis' | 'in_memory';
  usingFallback: boolean;
  circuitBreakerOpen: boolean;
  lastError?: string;
  latencyMs: number;
  memoryUsageBytes: number;
  activeEntries: number;
  timestamp: string;
}

export interface RegisterHealthCheckOptions {
  requireDeepAuth?: (request: any) => Promise<unknown> | unknown;
}

export class RateLimitHealthCheck {
  async check(store: RateLimitStore): Promise<RateLimitHealthStatus> {
    const start = Date.now();
    const memoryBefore = process.memoryUsage().heapUsed;

    try {
      await store.incrementWithLimit('health-check', 100, 60000);
      const latency = Date.now() - start;
      const memoryAfter = process.memoryUsage().heapUsed;

      return {
        healthy: true,
        storeType: this.getStoreType(store),
        usingFallback: this.isUsingFallback(store),
        circuitBreakerOpen: this.isCircuitBreakerOpen(store),
        latencyMs: latency,
        memoryUsageBytes: memoryAfter - memoryBefore,
        activeEntries: this.getActiveEntries(store),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const memoryAfter = process.memoryUsage().heapUsed;

      return {
        healthy: false,
        storeType: 'in_memory',
        usingFallback: true,
        circuitBreakerOpen: true,
        lastError: err instanceof Error ? err.message : 'Unknown error',
        latencyMs: latency,
        memoryUsageBytes: memoryAfter - memoryBefore,
        activeEntries: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async checkDeep(store: RateLimitStore): Promise<RateLimitHealthStatus & { details: any }> {
    const basic = await this.check(store);

    const details: any = {
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version,
      },
    };

    if (basic.storeType === 'redis' && this.hasCircuitBreaker(store)) {
      details.circuitBreaker = this.getCircuitBreakerState(store);
    }

    if (this.hasStoreSize(store)) {
      details.storeSize = store.getStoreSize?.();
    }

    return {
      ...basic,
      details,
    };
  }

  private getStoreType(store: RateLimitStore): 'redis' | 'in_memory' {
    return store.constructor.name === 'RedisRateLimitStore' ? 'redis' : 'in_memory';
  }

  private isUsingFallback(store: RateLimitStore): boolean {
    return store.didFallback?.() ?? false;
  }

  private isCircuitBreakerOpen(store: RateLimitStore): boolean {
    if (this.hasCircuitBreaker(store)) {
      const cbStore = store as any;
      return cbStore.isCircuitBreakerOpen?.() ?? false;
    }
    return false;
  }

  private hasCircuitBreaker(store: RateLimitStore): boolean {
    return (
      store instanceof Object &&
      'isCircuitBreakerOpen' in store &&
      typeof (store as any).isCircuitBreakerOpen === 'function'
    );
  }

  private getCircuitBreakerState(store: RateLimitStore): any {
    if (this.hasCircuitBreaker(store)) {
      const cbStore = store as any;
      return cbStore.getCircuitBreakerState?.() ?? null;
    }
    return null;
  }

  private getActiveEntries(store: RateLimitStore): number {
    if (this.hasStoreSize(store)) {
      return store.getStoreSize?.() ?? 0;
    }
    return 0;
  }

  private hasStoreSize(store: RateLimitStore): boolean {
    return 'getStoreSize' in store && typeof (store as any).getStoreSize === 'function';
  }
}

export function registerHealthCheckEndpoint(
  fastify: any,
  store: RateLimitStore,
  options: RegisterHealthCheckOptions = {},
): void {
  const checker = new RateLimitHealthCheck();

  fastify.get('/health/rate-limit', async (request: any, reply: any) => {
    const status = await checker.check(store);

    reply.code(status.healthy ? 200 : 503).send(status);
  });

  fastify.get('/health/rate-limit/deep', async (request: any, reply: any) => {
    if (options.requireDeepAuth) {
      await options.requireDeepAuth(request);
    }

    const status = await checker.checkDeep(store);

    reply.code(status.healthy ? 200 : 503).send(status);
  });
}
