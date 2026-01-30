import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration POST /api/donations/intent', { skip: !process.env.DOCKER_HOST && !process.env.TESTCONTAINERS_HOST_OVERRIDE }, () => {
  beforeAll(async () => {
    setTestEnv();
    const started = await startTestDb();
    prisma = started.prisma;
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('creates pending Donation and returns sessionId + url', async () => {
    const app = buildApp({ logger: false });

    // Mock Stripe at the instance level for this test (accurate: we validate our usage contract).
    (app as any).stripe.checkout.sessions.create = async (params: any) => {
      expect(params.metadata).toMatchObject({ source: 'agrobridgefoundation.org' });
      expect(params.line_items[0].price_data.unit_amount).toBe(5000);
      return { id: 'cs_test_123', url: 'https://stripe.test/cs_test_123' };
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/donations/intent',
      payload: { amount: 5000, currency: 'usd', donorEmail: 'donor@example.com', metadata: { campaign: 'mvp' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, data: { sessionId: 'cs_test_123', url: 'https://stripe.test/cs_test_123' } });

    const donation = await prisma.donation.findFirst({ where: { stripeSessionId: 'cs_test_123' } });
    expect(donation).toMatchObject({
      status: 'PENDING',
      amount: 5000,
      currency: 'usd',
      donorEmail: 'donor@example.com',
    });
  });
});
