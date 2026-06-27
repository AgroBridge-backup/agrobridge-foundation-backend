import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';

import { createRedisBackedRateLimitStore } from '../../../src/rate-limiting/fastify-rate-limit-redis-store.js';

/**
 * Real-Redis integration for the global @fastify/rate-limit store.
 *
 * The unit test uses a fake redis; this verifies the ACTUAL contract: that
 * node-redis's `sendCommand` EVAL/EVALSHA returns the `[current, ttl]` array
 * the parser expects, that INCR accumulates across calls, that PEXPIRE sets a
 * TTL on first increment, and that EVALSHA (with SCRIPT LOAD) works against a
 * real engine. Requires Docker (Testcontainers) — runs via `npm run test:integration`.
 */
describe('RedisBackedRateLimitStore — real Redis', () => {
  let container: StartedTestContainer;
  let redis: RedisClientType;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    redis = createClient({
      socket: { host: container.getHost(), port: container.getMappedPort(6379) },
    });
    await redis.connect();
  }, 120_000);

  afterAll(async () => {
    if (redis) await redis.quit();
    if (container) await container.stop();
  });

  test('INCR accumulates across calls and reports a positive TTL on first hit', async () => {
    const Store = createRedisBackedRateLimitStore(redis, 'integration-rl:');
    const store = new Store();
    // Unique key per test to avoid cross-test interference.
    const key = `acc-${Date.now()}`;

    const first = await new Promise<{ current: number; ttl: number }>((resolve, reject) =>
      store.incr(key, (err, res) => (err ? reject(err) : resolve(res as { current: number; ttl: number })), 60_000, 100),
    );
    const second = await new Promise<{ current: number; ttl: number }>((resolve, reject) =>
      store.incr(key, (err, res) => (err ? reject(err) : resolve(res as { current: number; ttl: number })), 60_000, 100),
    );

    expect(first.current).toBe(1);
    expect(first.ttl).toBeGreaterThan(0);
    expect(second.current).toBe(2);
    // TTL is only set on the first increment; on subsequent ones PTTL is read back.
    expect(second.ttl).toBeGreaterThan(0);
  });

  test('the bucket key actually expires (PEXPIRE applied, not just reported)', async () => {
    const Store = createRedisBackedRateLimitStore(redis, 'integration-ttl:');
    const store = new Store();
    const key = `ttl-${Date.now()}`;

    await new Promise<void>((resolve, reject) =>
      store.incr(key, (err) => (err ? reject(err) : resolve(undefined)), 100, 5),
    );
    // The key should have a TTL ~100ms. Wait for it to expire, then confirm a
    // fresh increment resets to 1 (proving the previous bucket truly expired).
    await new Promise((r) => setTimeout(r, 250));
    const after = await new Promise<{ current: number }>((resolve, reject) =>
      store.incr(key, (err, res) => (err ? reject(err) : resolve(res as { current: number })), 100, 5),
    );
    expect(after.current).toBe(1);
  });

  test('child() scopes buckets per route against real Redis', async () => {
    const Store = createRedisBackedRateLimitStore(redis, 'integration-child:');
    const root = new Store();
    const postStore = root.child({
      routeInfo: { method: 'POST', url: '/api/donations/intent' },
    }) as InstanceType<typeof Store>;

    const r1 = await new Promise<{ current: number }>((resolve, reject) =>
      postStore.incr('10.0.0.1', (err, res) => (err ? reject(err) : resolve(res as { current: number })), 60_000, 10),
    );
    const r2 = await new Promise<{ current: number }>((resolve, reject) =>
      postStore.incr('10.0.0.1', (err, res) => (err ? reject(err) : resolve(res as { current: number })), 60_000, 10),
    );
    expect(r1.current).toBe(1);
    expect(r2.current).toBe(2);

    // A different route's child store must NOT share the bucket.
    const getStore = root.child({
      routeInfo: { method: 'GET', url: '/api/health' },
    }) as InstanceType<typeof Store>;
    const other = await new Promise<{ current: number }>((resolve, reject) =>
      getStore.incr('10.0.0.1', (err, res) => (err ? reject(err) : resolve(res as { current: number })), 60_000, 10),
    );
    expect(other.current).toBe(1);
  });
});
