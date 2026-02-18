import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration /api/contacts', () => {
  beforeAll(async () => {
    setTestEnv();
    const started = await startTestDb();
    prisma = started.prisma;
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('persists ContactRequest (real Postgres)', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { name: 'Ada', email: 'ada@example.com', message: 'Hello' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.ok).toBe(true);

      const id = body.data.id as string;
      const row = await prisma.contactRequest.findUnique({ where: { id } });
      expect(row).toMatchObject({ name: 'Ada', email: 'ada@example.com', status: 'NEW' });
    } finally {
      await app.close();
    }
  });
});
