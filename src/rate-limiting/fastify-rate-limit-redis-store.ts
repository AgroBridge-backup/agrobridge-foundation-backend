import type { RedisClientType } from 'redis';
import type { FastifyRateLimitStoreCtor } from '@fastify/rate-limit';

/**
 * Custom @fastify/rate-limit store backed by node-redis.
 *
 * Why this exists: @fastify/rate-limit ships an ioredis-only RedisStore (it
 * calls `client.defineCommand`, which node-redis v4 does not provide). This
 * repo uses node-redis, so we need our own store. The increment logic mirrors
 * the built-in: an atomic INCR with TTL set on first increment, implemented as
 * a Lua script to avoid the race between a plain INCR and a separate PEXPIRE.
 */

// KEYS[1]  = rate-limit bucket key
// ARGV[1]  = time window in milliseconds
// returns  { current, ttlMs }
const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return { current, tonumber(ARGV[1]) }
end
return { current, redis.call('PTTL', KEYS[1]) }
`;

export interface IncrResult {
  current: number;
  ttl: number;
}

// The plugin passes its merged global params object to the constructor. We
// don't need them — the redis client and key prefix are captured via the
// factory closure — but the constructor signature must accept the arg to match
// @fastify/rate-limit's FastifyRateLimitStoreCtor shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RateLimitOptionsLike = Record<string, any>;

/**
 * Build a @fastify/rate-limit Store CLASS bound to a connected node-redis client.
 * Returns a class (not an instance) because the plugin instantiates the store
 * itself via `new Store(globalParams)`.
 *
 * Performance: the Lua script is loaded ONCE with SCRIPT LOAD (cached as a SHA
 * in the factory closure, shared by the root store and all route-scoped child
 * stores), then invoked via EVALSHA. This avoids re-sending the full script
 * body on every rate-limited request (the global limiter runs per request). On
 * a NOSCRIPT error (script evicted after Redis restart / FLUSHALL) we reset the
 * cache and fall back to EVAL, which also repopulates the cache.
 */
export function createRedisBackedRateLimitStore(
  redis: RedisClientType,
  defaultPrefix = 'rl:',
): FastifyRateLimitStoreCtor {
  // SHA cache shared by every store instance produced by this factory call
  // (the root store + all child() stores). The script body is constant, so its
  // SHA is stable; we load it lazily and reset on NOSCRIPT.
  let shaPromise: Promise<string> | null = null;

  const loadScript = (): Promise<string> => {
    if (!shaPromise) {
      shaPromise = redis
        .sendCommand<string>(['SCRIPT', 'LOAD', INCR_SCRIPT])
        .then((sha) => {
          const s = String(sha);
          if (!s) throw new Error('Empty SCRIPT LOAD response');
          return s;
        })
        .catch((err) => {
          // Reset so the next attempt retries instead of caching the rejection.
          shaPromise = null;
          throw err;
        });
    }
    return shaPromise;
  };

  const evalWithCache = async (fullKey: string, timeWindow: number): Promise<unknown> => {
    try {
      const sha = await loadScript();
      return await redis.sendCommand(['EVALSHA', sha, '1', fullKey, String(timeWindow)]);
    } catch (err) {
      // NOSCRIPT: the script isn't loaded (restart/FLUSHALL). Fall back to EVAL
      // (which re-loads) and clear the cache so the next call re-loads the SHA.
      if (err instanceof Error && /NOSCRIPT/i.test(err.message)) {
        shaPromise = null;
        return redis.sendCommand(['EVAL', INCR_SCRIPT, '1', fullKey, String(timeWindow)]);
      }
      throw err;
    }
  };

  // Cast: @fastify/rate-limit's FastifyRateLimitStore TS interface declares
  // `incr(key, callback)` with 2 params, but at runtime the plugin calls
  // `store.incr(key, cb, timeWindow, max)` (see node_modules/@fastify/rate-limit/index.js).
  // Our incr accepts the runtime 4-arg form, which is assignable to the 2-arg
  // interface, and the store contract is covered by unit + integration tests.
  return class RedisBackedRateLimitStore {
    constructor(
      _options?: RateLimitOptionsLike,
      private readonly keyPrefix: string = defaultPrefix,
    ) {}

    incr(
      key: string,
      callback: (error: Error | null, result?: IncrResult) => void,
      timeWindow: number,
      _max?: number,
    ): void {
      const fullKey = this.keyPrefix + key;
      evalWithCache(fullKey, timeWindow)
        .then((res: unknown) => {
          const arr = Array.isArray(res)
            ? (res as Array<number | string>)
            : [res as number, timeWindow];
          const current = Number(arr[0]);
          const rawTtl = Number(arr[1]);
          // PTTL can return -1 (no expiry) or -2 (no key) in pathological cases;
          // fall back to the configured window so the limiter degrades safely.
          const ttl = rawTtl > 0 ? rawTtl : timeWindow;
          callback(null, { current: Number.isFinite(current) ? current : 0, ttl });
        })
        .catch((err: Error) => callback(err));
    }

    child(routeOptions: RateLimitOptionsLike): RedisBackedRateLimitStore {
      const info = (routeOptions?.routeInfo ?? {}) as { method?: string; url?: string };
      const childPrefix = `${this.keyPrefix}${info.method ?? ''}${info.url ?? ''}-`;
      return new RedisBackedRateLimitStore(undefined, childPrefix);
    }
  } as unknown as FastifyRateLimitStoreCtor;
}
