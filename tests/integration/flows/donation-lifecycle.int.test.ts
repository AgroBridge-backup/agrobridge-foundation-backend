import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/setup-db.js';
import { setTestEnv } from '../../helpers/env.js';
import type { FastifyInstance } from 'fastify';

/**
 * Donation lifecycle integration tests.
 *
 * NOTE: these require a live Postgres + Redis (provisioned via testcontainers
 * in setupTestDatabase / buildApp). They assert REAL state transitions, not
 * just HTTP status — the webhook path is mocked at constructEvent (so signature
 * verification is bypassed intentionally) and the resulting DB state is checked.
 * A separate test below verifies that an INVALID signature produces 400 with
 * zero side effects (signature is verified before any write).
 */
describe('Donation Lifecycle Integration Tests', () => {
  let app: FastifyInstance;
  let sessionCounter = 0;

  beforeAll(async () => {
    setTestEnv();
    await setupTestDatabase();
    app = await buildApp({ logger: false });
    await app.ready();
    (app as any).stripe.checkout.sessions.create = async () => {
      sessionCounter += 1;
      return {
        id: `cs_test_${sessionCounter}`,
        url: `https://stripe.test/cs_test_${sessionCounter}`,
      };
    };
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await app.prisma.donation.deleteMany();
    await app.prisma.webhookEvent.deleteMany();
  });

  afterEach(async () => {
    await app.prisma.webhookEvent.deleteMany();
    await app.prisma.donation.deleteMany();
  });

  // Create an intent. The money path now REQUIRES an Idempotency-Key.
  async function createIntent(amount = 5000) {
    return app.inject({
      method: 'POST',
      url: '/api/donations/intent',
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { amount, currency: 'usd', donorEmail: 'donor@example.com' },
    });
  }

  // Deliver a webhook with constructEvent mocked to return `event` (bypasses
  // signature verification so we can exercise the downstream DB logic).
  async function deliverWebhook(event: Record<string, unknown>) {
    (app as any).stripe.webhooks.constructEvent = () => event;
    return app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=sig' },
      payload: Buffer.from('{"id":"evt"}'),
    });
  }

  describe('Complete donation flow', () => {
    it('creates a donation intent in PENDING state', async () => {
      const res = await createIntent();

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.ok).toBe(true);
      expect(data.data.sessionId).toBeDefined();

      const donation = await app.prisma.donation.findFirst({
        where: { stripeSessionId: data.data.sessionId },
      });
      expect(donation?.status).toBe('PENDING');
      expect(donation?.amount).toBe(5000);
      expect(donation?.donorEmail).toBe('donor@example.com');
    });

    it('marks a donation EXPIRED on checkout.session.expired', async () => {
      const intent = await createIntent();
      const sessionId = intent.json().data.sessionId;

      const res = await deliverWebhook({
        id: `evt_${Date.now()}`,
        type: 'checkout.session.expired',
        data: { object: { id: sessionId } },
      });

      expect(res.statusCode).toBe(200);
      const donation = await app.prisma.donation.findFirst({
        where: { stripeSessionId: sessionId },
      });
      expect(donation?.status).toBe('EXPIRED');
    });

    it('marks a donation SUCCEEDED and is idempotent on redelivery of the same event id', async () => {
      const intent = await createIntent();
      const sessionId = intent.json().data.sessionId;
      const eventId = `evt_${Date.now()}`;
      const event = {
        id: eventId,
        type: 'checkout.session.completed',
        data: { object: { id: sessionId } },
      };

      const res1 = await deliverWebhook(event);
      expect(res1.statusCode).toBe(200);
      const afterFirst = await app.prisma.donation.findFirst({
        where: { stripeSessionId: sessionId },
      });
      expect(afterFirst?.status).toBe('SUCCEEDED');

      // Redeliver the SAME event id — must be an exact-once no-op.
      const res2 = await deliverWebhook(event);
      expect(res2.statusCode).toBe(200);

      const events = await app.prisma.webhookEvent.findMany({ where: { id: eventId } });
      expect(events.length).toBe(1);
      expect(events[0]?.processed).toBe(true);

      const afterSecond = await app.prisma.donation.findFirst({
        where: { stripeSessionId: sessionId },
      });
      expect(afterSecond?.status).toBe('SUCCEEDED');
    });

    it('rejects an invalid signature with 400 and NO side effects (signature verified before any write)', async () => {
      const intent = await createIntent();
      const sessionId = intent.json().data.sessionId;

      // Make constructEvent throw, simulating a bad/missing signature. The
      // handler must reject BEFORE persisting a WebhookEvent or touching the
      // donation.
      (app as any).stripe.webhooks.constructEvent = () => {
        throw new Error('No signatures found matching the expected signature for payload');
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=BAD' },
        payload: Buffer.from('{"id":"evt_bad"}'),
      });

      expect(res.statusCode).toBe(400);

      // No webhook event row persisted.
      const events = await app.prisma.webhookEvent.findMany({});
      expect(events.length).toBe(0);

      // Donation untouched.
      const donation = await app.prisma.donation.findFirst({
        where: { stripeSessionId: sessionId },
      });
      expect(donation?.status).toBe('PENDING');
    });
  });
});
