import { describe, expect, it, vi } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';

import { buildApp } from '../../src/app.js';

import { setTestEnv } from '../../helpers/env';

// buildApp() awaits connectRedis(); with no Redis in the unit env that hangs on
// reconnect. Mock the cache module so app construction is sync and fast.
vi.mock('../../src/cache/redis-client.js', () => ({
  connectRedis: vi.fn(async () => {}),
  disconnectRedis: vi.fn(async () => {}),
  getRedisClient: vi.fn(() => undefined),
}));

describe('Admin routes authz', () => {
  it('denies access without cookie', async () => {
    setTestEnv();
    const app = await buildApp({ logger: false });

    const res = await app.inject({ method: 'GET', url: '/api/admin/donations' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    });
  });
});
