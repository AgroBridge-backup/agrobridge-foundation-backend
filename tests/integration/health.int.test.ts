import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration /api/health', { skip: !process.env.DOCKER_HOST && !process.env.TESTCONTAINERS_HOST_OVERRIDE }, () => {
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

  it('returns ok when DB is available', async () => {
    const app = buildApp({ logger: false });

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.db).toBe('ok');
  });
});
