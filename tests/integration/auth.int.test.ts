
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration /api/auth/login', () => {
  beforeAll(async () => {
    setTestEnv();
    const started = await startTestDb();
    prisma = started.prisma;

    const passwordHash = await bcrypt.hash('pw123', 4);
    await prisma.adminUser.create({
      data: { email: 'admin@example.com', passwordHash, role: 'ADMIN' },
    });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('sets signed httpOnly cookie and updates lastLoginAt', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com', password: 'pw123' },
      });

      expect(res.statusCode).toBe(200);

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toContain('ab_admin=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const updated = await prisma.adminUser.findUnique({ where: { email: 'admin@example.com' } });
      expect(updated?.lastLoginAt).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });

  it('blocks login when account is locked in the database', async () => {
    await prisma.adminUser.update({
      where: { email: 'admin@example.com' },
      data: {
        failedAttempts: 5,
        lockedUntil: new Date(Date.now() + 60_000),
      },
    });

    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com', password: 'pw123' },
      });

      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      expect(res.json()).toMatchObject({
        ok: false,
        error: {
          code: 'ACCOUNT_LOCKED',
        },
      });
    } finally {
      await app.close();
    }
  });
});
