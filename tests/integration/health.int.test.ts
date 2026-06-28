import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { disconnectRedis } from '../../src/cache/redis-client.js';
import { signAdminCookie } from '../helpers/admin-cookie.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration /api/health', () => {
  beforeAll(async () => {
    setTestEnv();
    const started = await startTestDb();
    prisma = started.prisma;

    // Ensure DB is reachable.
    await prisma.$queryRaw`SELECT 1`;
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('returns ok when DB and Redis are available', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('ok');
      expect(body.data.db).toBe('ok');
      expect(body.data.redis).toBe('ok');
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('requires auth for deep health endpoint', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const unauthenticated = await app.inject({ method: 'GET', url: '/api/health/deep' });
      expect(unauthenticated.statusCode).toBe(401);

      const unauthenticatedRateLimitDeep = await app.inject({
        method: 'GET',
        url: '/api/health/rate-limit/deep',
      });
      expect(unauthenticatedRateLimitDeep.statusCode).toBe(401);

      const token = await app.jwt.sign(
        { sub: 'admin1', email: 'admin@x.com', role: 'ADMIN' },
        { expiresIn: '24h' },
      );
      const cookie = await signAdminCookie(app, token);

      const authenticated = await app.inject({
        method: 'GET',
        url: '/api/health/deep',
        headers: { cookie },
      });

      expect(authenticated.statusCode).toBe(200);
      const body = authenticated.json();
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('ok');
      expect(body.data.redis).toBe('ok');
      expect(body.data.uptimeSeconds).toBeTypeOf('number');

      const authenticatedRateLimitDeep = await app.inject({
        method: 'GET',
        url: '/api/health/rate-limit/deep',
        headers: { cookie },
      });
      expect(authenticatedRateLimitDeep.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns 503 with ok:false when Redis is unavailable', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      // Force Redis into an unavailable state for this check. disconnectRedis
      // quits the connected singleton; the next getRedisClient() lazily creates
      // a client that is never connected, so ping() rejects and the readiness
      // probe reports redis as down (the failure mode that previously returned
      // 200 and hid idempotency fail-open).
      await disconnectRedis();

      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);

      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.redis).toBe('down');
      // The DB is still up in this scenario, proving the check reports each
      // dependency independently rather than a single aggregate.
      expect(body.db).toBe('ok');
    } finally {
      await app.close();
    }
  });
});

