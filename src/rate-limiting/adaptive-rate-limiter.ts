import { RateLimitStore, RateLimitResult } from './rate-limit-store.js';
import { RateLimitTier } from './tier-config.js';
import { requestContext } from '../observability/request-context.js';

interface SystemLoadMetrics {
  cpu: number;
  memory: number;
  redisLatency: number;
  customLoad: number;
}

export interface AdaptiveRateLimiterConfig {
  minLoadFactor: number;
  maxLoadFactor: number;
  loadFactorStep: number;
  recoveryFactor: number;
  highLoadThreshold: number;
  lowLoadThreshold: number;
  checkInterval: number;
}

export class AdaptiveRateLimiter implements RateLimitStore {
  private readonly baseStore: RateLimitStore;
  private readonly logger: ReturnType<typeof requestContext.getLog>;
  private loadFactor: number = 1.0;
  private systemLoad: SystemLoadMetrics = {
    cpu: 0,
    memory: 0,
    redisLatency: 0,
    customLoad: 0,
  };
  private lastLoadCheck: number = 0;
  private readonly config: AdaptiveRateLimiterConfig;

  constructor(baseStore: RateLimitStore, config?: Partial<AdaptiveRateLimiterConfig>) {
    this.baseStore = baseStore;
    this.logger = requestContext.getLog();
    this.config = {
      minLoadFactor: 0.5,
      maxLoadFactor: 1.0,
      loadFactorStep: 0.1,
      recoveryFactor: 0.05,
      highLoadThreshold: 0.8,
      lowLoadThreshold: 0.5,
      checkInterval: 5000,
      ...config,
    };
  }

  async get(identifier: string): Promise<any> {
    return this.baseStore.get(identifier);
  }

  async incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult> {
    await this.updateLoadFactorIfNeeded();

    const adjustedLimit = Math.max(1, Math.floor(maxRequests * this.loadFactor));
    const result = await this.baseStore.incrementWithLimit(identifier, adjustedLimit, timeWindowMs);

    if (this.loadFactor < 1.0) {
      this.logger?.debug(
        {
          identifier,
          originalLimit: maxRequests,
          adjustedLimit,
          loadFactor: this.loadFactor,
        },
        'Adaptive rate limit applied',
      );
    }

    return {
      ...result,
    };
  }

  async delete(identifier: string): Promise<void> {
    return this.baseStore.delete(identifier);
  }

  async cleanup(): Promise<void> {
    return this.baseStore.cleanup();
  }

  getLoadFactor(): number {
    return this.loadFactor;
  }

  getSystemLoad(): SystemLoadMetrics {
    return { ...this.systemLoad };
  }

  async setCustomLoad(load: number): Promise<void> {
    this.systemLoad.customLoad = Math.min(1, Math.max(0, load));
    await this.updateLoadFactorIfNeeded();
  }

  private async updateLoadFactorIfNeeded(): Promise<void> {
    const now = Date.now();

    if (now - this.lastLoadCheck < this.config.checkInterval) {
      return;
    }

    this.systemLoad = await this.getCurrentSystemLoad();
    const totalLoad = this.calculateTotalLoad();

    if (totalLoad > this.config.highLoadThreshold) {
      this.loadFactor = Math.max(
        this.config.minLoadFactor,
        this.loadFactor - this.config.loadFactorStep,
      );
    } else if (totalLoad < this.config.lowLoadThreshold && this.loadFactor < 1.0) {
      this.loadFactor = Math.min(
        this.config.maxLoadFactor,
        this.loadFactor + this.config.recoveryFactor,
      );
    }

    this.lastLoadCheck = now;

    if (this.loadFactor !== 1.0) {
      this.logger?.info(
        {
          loadFactor: this.loadFactor,
          systemLoad: this.systemLoad,
          totalLoad,
        },
        'Adaptive rate limiter: load factor updated',
      );
    }
  }

  private async getCurrentSystemLoad(): Promise<SystemLoadMetrics> {
    const [cpu, memory, redisLatency] = await Promise.all([
      this.getCpuUsage(),
      this.getMemoryUsage(),
      this.getRedisLatency(),
    ]);

    return {
      cpu,
      memory,
      redisLatency,
      customLoad: this.systemLoad.customLoad,
    };
  }

  private calculateTotalLoad(): number {
    const weights = { cpu: 0.3, memory: 0.3, redisLatency: 0.4 };
    return (
      this.systemLoad.cpu * weights.cpu +
      this.systemLoad.memory * weights.memory +
      this.systemLoad.redisLatency * weights.redisLatency +
      this.systemLoad.customLoad
    );
  }

  private async getCpuUsage(): Promise<number> {
    const usage = process.cpuUsage();
    const total = usage.user + usage.system;
    const elapsed = process.uptime() * 1000000;
    return Math.min(1, total / elapsed);
  }

  private async getMemoryUsage(): Promise<number> {
    const usage = process.memoryUsage();
    const maxMemory = 2 * 1024 * 1024 * 1024;
    return Math.min(1, usage.heapUsed / maxMemory);
  }

  private async getRedisLatency(): Promise<number> {
    const start = Date.now();
    try {
      await this.baseStore.get('latency-check');
      const latency = Date.now() - start;
      return Math.min(1, Math.max(0, latency / 100));
    } catch (err) {
      return 1;
    }
  }

  resetLoadFactor(): void {
    this.loadFactor = 1.0;
    this.logger?.info({ loadFactor: 1.0 }, 'Adaptive rate limiter: load factor reset');
  }
}
