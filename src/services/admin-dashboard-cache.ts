type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

// Tiny in-memory TTL cache.
//
// Purpose:
// - protect DB from refresh storms on /api/admin/dashboard
// - keep implementation simple for MVP
//
// Notes:
// - per-process only; each ECS task has its own cache
// - safe for metrics endpoints (eventual consistency)

export class TtlCache<T> {
  private entry: CacheEntry<T> | null = null;

  get(now = Date.now()): T | null {
    if (!this.entry) return null;
    if (now >= this.entry.expiresAt) {
      this.entry = null;
      return null;
    }
    return this.entry.value;
  }

  set(value: T, ttlMs: number, now = Date.now()): void {
    this.entry = { value, expiresAt: now + ttlMs };
  }

  clear(): void {
    this.entry = null;
  }
}
