export interface RateLimitEntry {
  count: number;
  resetTime: Date;
}

export interface RateLimitResult {
  count: number;
  allowed: boolean;
  resetTime: Date;
}

export interface RateLimitStore {
  get(identifier: string): Promise<RateLimitEntry | null>;
  incrementWithLimit(
    identifier: string,
    maxRequests: number,
    timeWindowMs: number,
  ): Promise<RateLimitResult>;
  delete(identifier: string): Promise<void>;
  cleanup(): void | Promise<void>;
  didFallback?(): boolean;
  getStoreSize?(): number;
}
