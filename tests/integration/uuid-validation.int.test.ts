import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../src/app.js';
import { signAdminCookie } from '../helpers/admin-cookie.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

describe('Integration UUID validation for restore/reset routes', () => {
  let app: FastifyInstance;
  let superAdminCookie: string;

  beforeAll(async () => {
    setTestEnv();
    await startTestDb();
    app = await buildApp({ logger: false });
    await app.ready();

    const token = await app.jwt.sign(
      { sub: 'super-admin-id', email: 'super-admin@agrobridge.org', role: 'SUPER_ADMIN' },
      { expiresIn: '24h' },
    );
    superAdminCookie = await signAdminCookie(app, token);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await stopTestDb();
  });

  it('returns 400 for invalid UUID on admin user restore', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users/not-a-uuid/restore',
      headers: { cookie: superAdminCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format' },
    });
  });

  it('returns 400 for invalid UUID on admin user reset-password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users/not-a-uuid/reset-password',
      headers: { cookie: superAdminCookie },
      payload: { newPassword: 'StrongPassword123!' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid user ID format' },
    });
  });

  it('returns 400 for invalid UUID on campaign restore', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/campaigns/not-a-uuid/restore',
      headers: { cookie: superAdminCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign ID format' },
    });
  });
});
