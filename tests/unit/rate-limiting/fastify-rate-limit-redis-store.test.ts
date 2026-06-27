import { describe, expect, test } from 'vitest';

import { createRedisBackedRateLimitStore } from '../../../src/rate-limiting/fastify-rate-limit-redis-store.js';

/**
 * §9.7 fix + audit follow-up: the global @fastify/rate-limit cap was
 * in-memory/per-instance only. It now uses a node-redis-backed custom store
 * (the built-in RedisStore is ioredis-only). These tests cover the store's
 * contract against a fake redis, including the EVALSHA-with-caching path and
 * the NOSCRIPT fallback.
 *
 * Distinct from src/rate-limiting/redis-rate-limit-store.ts (the TIERED
 * limiter's store) — this store is for the GLOBAL @fastify/rate-limit plugin.
 */

interface FakeRedisState {
  result: unknown; // what EVAL/EVALSHA returns
  evalshaThrowsNoScript: boolean;
  scriptsLoaded: number;
  evalshaCalls: number;
  evalCalls: number;
}

function makeFakeRedis(initialResult: unknown = [1, 60000]) {
  const state: FakeRedisState = {
    result: initialResult,
    evalshaThrowsNoScript: false,
    scriptsLoaded: 0,
    evalshaCalls: 0,
    evalCalls: 0,
  };
  const calls: string[][] = [];
  const client = {
    sendCommand: async (args: string[]) => {
      calls.push(args);
      const cmd = args[0];
      if (cmd === 'SCRIPT') {
        state.scriptsLoaded += 1;
        return 'sha-abc';
      }
      if (cmd === 'EVALSHA') {
        state.evalshaCalls += 1;
        if (state.evalshaThrowsNoScript) {
          throw new Error("NOSCRIPT No matching script. Please use EVAL.");
        }
        return state.result;
      }
      if (cmd === 'EVAL') {
        state.evalCalls += 1;
        return state.result;
      }
      throw new Error(`unexpected command ${cmd}`);
    },
  };
  return { calls, state, client };
}

function callIncr(
  store: InstanceType<ReturnType<typeof createRedisBackedRateLimitStore>>,
  key: string,
  timeWindow = 60000,
): Promise<{ current: number; ttl: number }> {
  return new Promise((resolve, reject) =>
    store.incr(key, (err, res) => (err ? reject(err) : resolve(res as { current: number; ttl: number })), timeWindow, 200),
  );
}

describe('RedisBackedRateLimitStore (global @fastify/rate-limit store)', () => {
  test('loads the script once, then EVALSHAs with the prefixed key', async () => {
    const fake = makeFakeRedis([3, 42000]);
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();

    const result = await callIncr(store, '1.2.3.4');

    expect(result).toEqual({ current: 3, ttl: 42000 });
    // SCRIPT LOAD happened, then EVALSHA with the prefixed key.
    expect(fake.state.scriptsLoaded).toBe(1);
    expect(fake.state.evalshaCalls).toBe(1);
    expect(fake.state.evalCalls).toBe(0);
    const evalshaCall = fake.calls.find((c) => c[0] === 'EVALSHA');
    expect(evalshaCall?.[3]).toBe('rl:1.2.3.4');
    expect(evalshaCall?.[4]).toBe('60000');
  });

  test('caches the SHA across calls (no second SCRIPT LOAD)', async () => {
    const fake = makeFakeRedis([2, 5000]);
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();

    await callIncr(store, 'a');
    await callIncr(store, 'b');

    expect(fake.state.scriptsLoaded).toBe(1); // loaded once
    expect(fake.state.evalshaCalls).toBe(2); // two EVALSHAs
  });

  test('falls back to EVAL on NOSCRIPT, then re-loads the SHA on the next call', async () => {
    const fake = makeFakeRedis([5, 9000]);
    fake.state.evalshaThrowsNoScript = true; // simulate script evicted
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();

    // First call: SCRIPT LOAD ok, EVALSHA -> NOSCRIPT -> EVAL fallback succeeds.
    const r1 = await callIncr(store, 'k');
    expect(r1).toEqual({ current: 5, ttl: 9000 });
    expect(fake.state.evalCalls).toBe(1);

    // After NOSCRIPT the cache resets; the next call re-loads (SCRIPT LOAD again).
    // Re-arm EVALSHA so the retried path works.
    fake.state.evalshaThrowsNoScript = false;
    await callIncr(store, 'k');
    expect(fake.state.scriptsLoaded).toBe(2);
  });

  test('falls back to the configured window when PTTL is non-positive', async () => {
    const fake = makeFakeRedis([2, -2]);
    const Store = createRedisBackedRateLimitStore(fake.client as never);
    const store = new Store();
    const result = await callIncr(store, 'k', 30000);
    expect(result).toEqual({ current: 2, ttl: 30000 });
  });

  test('propagates non-NOSCRIPT redis errors (so skipOnError can fail open)', async () => {
    const failing = {
      sendCommand: async (args: string[]) => {
        if (args[0] === 'SCRIPT') return 'sha';
        throw new Error('ECONNRESET');
      },
    };
    const Store = createRedisBackedRateLimitStore(failing as never);
    const store = new Store();
    await expect(callIncr(store, 'k')).rejects.toThrow('ECONNRESET');
  });

  test('child() derives a method+url-scoped key prefix', async () => {
    const fake = makeFakeRedis();
    const Store = createRedisBackedRateLimitStore(fake.client as never, 'rl:');
    const root = new Store();
    const child = root.child({
      routeInfo: { method: 'POST', url: '/api/donations/intent' },
    }) as InstanceType<typeof Store>;

    await callIncr(child, '1.1.1.1');
    const evalshaCall = fake.calls.find((c) => c[0] === 'EVALSHA');
    expect(evalshaCall?.[3]).toBe('rl:POST/api/donations/intent-1.1.1.1');
  });

  test('respects a custom default prefix', async () => {
    const fake = makeFakeRedis([1, 60000]);
    const Store = createRedisBackedRateLimitStore(fake.client as never, 'global-rl:');
    const store = new Store();
    await callIncr(store, 'ip');
    const evalshaCall = fake.calls.find((c) => c[0] === 'EVALSHA');
    expect(evalshaCall?.[3]).toBe('global-rl:ip');
  });
});
