import { describe, expect, it } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';

import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../../helpers/env';

describe('Stripe webhook route', () => {
  it('returns 400 if missing stripe-signature', async () => {
    setTestEnv();
    const app = buildApp({ logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      payload: '{"x":1}',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    });

    expect(res.statusCode).toBe(400);
  });
});
