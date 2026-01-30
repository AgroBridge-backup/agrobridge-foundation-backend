/**
 * LRU (Least Recently Used) Cache with automatic size enforcement
 * Thread-safe for single-threaded Node.js - no locks needed
 */
export class LRUCache<K, V> implements Map<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('maxSize must be a positive integer');
    }
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  // O(1) access - marks as recently used
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }

    // Re-insert to mark as recently used (maintains LRU order)
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;

    return value;
  }

  // O(1) insert with automatic eviction
  set(key: K, value: V): this {
    // Delete if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add new entry (at the end = most recent)
    this.cache.set(key, value);

    // Enforce max size - remove oldest entry (first key)
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    return this;
  }

  // O(1) delete
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  // O(1) check existence
  has(key: K): boolean {
    return this.cache.has(key);
  }

  // O(1) size
  get size(): number {
    return this.cache.size;
  }

  // O(n) clear
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // Iterator methods for Map interface
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void {
    this.cache.forEach(callbackfn);
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.cache[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return 'LRUCache';
  }

  // Metrics for observability
  getStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
    };
  }

  // Reset hit/miss counters (useful for testing or periodic metric resets)
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

export default LRUCache;
