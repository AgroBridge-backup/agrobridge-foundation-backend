import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration POST /api/webhooks/stripe (idempotent)', () => {
  beforeAll(async () => {
    setTestEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const started = await startTestDb();
    prisma = started.prisma;

    await prisma.donation.create({
      data: { amount: 5000, currency: 'usd', status: 'PENDING', stripeSessionId: 'cs_123' },
    });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('processes checkout.session.completed and is idempotent by event.id', async () => {
    const app = await buildApp({ logger: false });
    await app.ready();

    try {
      // Mock constructEvent to avoid relying on Stripe internals, but still validate route behavior + DB effects.
      (app as any).stripe.webhooks.constructEvent = () => ({
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123' } },
      });

      const payload = Buffer.from('{"id":"evt_123"}');

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'sig',
        },
      });

      expect(res1.statusCode).toBe(200);

      const donationAfter = await prisma.donation.findFirst({ where: { stripeSessionId: 'cs_123' } });
      expect(donationAfter?.status).toBe('SUCCEEDED');

      // Replay same event id => should not duplicate processing.
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': 'sig',
        },
      });

      expect(res2.statusCode).toBe(200);

      const events = await prisma.webhookEvent.findMany({ where: { id: 'evt_123' } });
      expect(events.length).toBe(1);
    } finally {
      await app.close();
    }
  });
});
