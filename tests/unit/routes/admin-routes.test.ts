import { describe, expect, it } from 'vitest';
import { Errors } from '../../src/errors/app-error.js';

import { buildApp } from '../../src/app.js';

import { setTestEnv } from '../../helpers/env';

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
