import { RateLimitStore, RateLimitEntry, RateLimitResult } from './rate-limit-store.js';

export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private readonly cleanupIntervalMs: number = 60_000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }

  async get(identifier: string): Promise<RateLimitEntry | null> {
    return this.store.get(identifier) || null;
  }

  async incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult> {
    const now = new Date();
    const entry = this.store.get(identifier);

    let count = 0;
    let resetTime: Date;

    if (entry && entry.resetTime >= now) {
      count = entry.count;
      resetTime = entry.resetTime;
    } else {
      resetTime = new Date(now.getTime() + timeWindowMs);
    }

    const allowed = count < maxRequests;
    if (allowed) {
      count++;
    }

    const newEntry = { count, resetTime };
    this.store.set(identifier, newEntry);

    return {
      count,
      allowed,
      resetTime,
    };
  }

  async delete(identifier: string): Promise<void> {
    this.store.delete(identifier);
  }

  cleanup(): void {
    const now = new Date();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  getStoreSize(): number {
    return this.store.size;
  }
}
