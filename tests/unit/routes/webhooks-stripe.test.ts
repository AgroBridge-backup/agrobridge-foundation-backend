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

describe('Stripe webhook route', () => {
  it('returns 400 if missing stripe-signature', async () => {
    setTestEnv();
    const app = await buildApp({ logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      payload: '{"x":1}',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    });

    expect(res.statusCode).toBe(400);
  });
});
