import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('E2E /api/health', () => {
  it('returns unready when DB unavailable', async () => {
    const { setTestEnv } = await import('../helpers/env.js');
    setTestEnv();

    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });

      // With a fake DATABASE_URL, health should report dependency unready.
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'DB unavailable' },
      });
    } finally {
      await app.close();
    }
  });
});
