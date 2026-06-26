import { describe, expect, test } from 'vitest';

import { createRedisBackedRateLimitStore } from '../../../src/rate-limiting/fastify-rate-limit-redis-store.js';

/**
 * §9.7 fix: the global @fastify/rate-limit cap was in-memory/per-instance only
 * (no `store` configured), so it silently weakened when scaled horizontally.
 * It now uses a node-redis-backed custom store (the built-in RedisStore is
 * ioredis-only). These tests verify the store's contract against a fake redis.
 *
 * NOTE: this is distinct from src/rate-limiting/redis-rate-limit-store.ts
 * (the TIERED limiter's store). This store is for the GLOBAL @fastify/rate-limit
 * plugin instance registered in app.ts.
 */

function makeFakeRedis(nextResult: unknown = [1, 60000]) {
  const calls: string[][] = [];
  const state = { nextResult };
  return {
    calls,
    set nextResult(v: unknown) {
      state.nextResult = v;
    },
    client: {
      sendCommand: async (args: string[]) => {
        calls.push(args);
        return state.nextResult;
      },
    },
  };
}

describe('RedisBackedRateLimitStore (global @fastify/rate-limit store)', () => {
  test('incr EVALs the atomic INCR+TTL script with the prefixed key', async () => {
    const fake = makeFakeRedis([3, 42000]);
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();

    const result = await new Promise<{ current: number; ttl: number }>((resolve) =>
      store.incr('1.2.3.4', (_e, res) => resolve(res as { current: number; ttl: number }), 60000, 200),
    );

    // Command shape: ['EVAL', script, '1', 'rl:1.2.3.4', '60000']
    expect(fake.calls[0]?.[0]).toBe('EVAL');
    expect(fake.calls[0]?.[2]).toBe('1'); // number of keys
    expect(fake.calls[0]?.[3]).toBe('rl:1.2.3.4'); // prefixed key
    expect(fake.calls[0]?.[4]).toBe('60000'); // time window
    expect(result).toEqual({ current: 3, ttl: 42000 });
  });

  test('falls back to the configured window when PTTL is non-positive', async () => {
    const fake = makeFakeRedis([2, -2]); // PTTL returned -2 (key gone)
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();
    const result = await new Promise<{ current: number; ttl: number }>((resolve) =>
      store.incr('k', (_e, res) => resolve(res as { current: number; ttl: number }), 30000, 100),
    );
    expect(result).toEqual({ current: 2, ttl: 30000 });
  });

  test('propagates redis errors via the callback (so skipOnError can fail open)', async () => {
    const failing = {
      sendCommand: async () => {
        throw new Error('ECONNRESET');
      },
    };
    const Store = createRedisBackedRateLimitStore(failing as never);
    const store = new Store();
    const result = await new Promise<{ error: Error | null }>((resolve) =>
      store.incr('k', (error) => resolve({ error }), 60000, 200),
    );
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('ECONNRESET');
  });

  test('child() derives a method+url-scoped key prefix', async () => {
    const fake = makeFakeRedis();
    const Store = createRedisBackedRateLimitStore(fake.client as never, 'rl:');
    const root = new Store();
    const child = root.child({ routeInfo: { method: 'POST', url: '/api/donations/intent' } }) as {
      incr: (k: string, cb: (e: Error | null, r?: { current: number; ttl: number }) => void, t: number) => void;
    };

    await new Promise<void>((resolve) => child.incr('1.1.1.1', () => resolve(), 60000));
    // child key prefix encodes the route: rl:POST/api/donations/intent-1.1.1.1
    expect(fake.calls[0]?.[3]).toBe('rl:POST/api/donations/intent-1.1.1.1');
  });

  test('respects a custom default prefix', async () => {
    const fake = makeFakeRedis([1, 60000]);
    const Store = createRedisBackedRateLimitStore(fake.client as never, 'global-rl:');
    const store = new Store();
    await new Promise((resolve) => store.incr('ip', () => resolve(undefined), 60000, 200));
    expect(fake.calls[0]?.[3]).toBe('global-rl:ip');
  });
});
