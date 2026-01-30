
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration /api/auth/login', { skip: !process.env.DOCKER_HOST && !process.env.TESTCONTAINERS_HOST_OVERRIDE }, () => {
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
    const app = buildApp({ logger: false });

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
  });
});
