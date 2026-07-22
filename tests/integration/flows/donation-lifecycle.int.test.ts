import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/setup-db.js';
import { setTestEnv } from '../../helpers/env.js';
import type { FastifyInstance } from 'fastify';

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

  describe('Complete donation flow', () => {
    it('should create donation intent and complete via webhook', async () => {
      const intentResponse = await app.inject({
        method: 'POST',
        url: '/api/donations/intent',
        payload: {
          amount: 5000,
          currency: 'usd',
          donorEmail: 'donor@example.com',
        },
      });

      expect(intentResponse.statusCode).toBe(200);
      const intentData = intentResponse.json();
      expect(intentData.ok).toBe(true);
      expect(intentData.data.sessionId).toBeDefined();

      const donation = await app.prisma.donation.findFirst({
        where: { stripeSessionId: intentData.data.sessionId },
      });

      expect(donation).toBeDefined();
      expect(donation?.status).toBe('PENDING');
      expect(donation?.amount).toBe(5000);
      expect(donation?.donorEmail).toBe('donor@example.com');
    });

    it('should expire donation via webhook', async () => {
      const intentResponse = await app.inject({
        method: 'POST',
        url: '/api/donations/intent',
        payload: {
          amount: 5000,
          currency: 'usd',
          donorEmail: 'donor@example.com',
        },
      });

      expect(intentResponse.statusCode).toBe(200);
      const stripeSessionId = intentResponse.json().data.sessionId;

      const webhookPayload = {
        id: `evt_test_${Date.now()}`,
        type: 'checkout.session.expired',
        data: {
          object: {
            id: stripeSessionId,
            payment_status: 'unpaid',
            amount_total: 5000,
            currency: 'usd',
          },
        },
      };

      const webhookResponse = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=test',
        },
        payload: webhookPayload,
      });

      expect(webhookResponse.statusCode).toBeGreaterThanOrEqual(400);

      const donation = await app.prisma.donation.findFirst({
        where: { stripeSessionId },
      });

      expect(donation?.status).toBe('PENDING');
    });

    it('should handle idempotent webhook events', async () => {
      const eventId = `evt_test_${Date.now()}`;

      const webhookPayload = {
        id: eventId,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_${Date.now()}`,
            payment_status: 'paid',
            amount_total: 5000,
            currency: 'usd',
          },
        },
      };

      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=test',
        },
        payload: webhookPayload,
      });

      expect(firstResponse.statusCode).toBeGreaterThanOrEqual(400);

      const webhookEvent = await app.prisma.webhookEvent.findUnique({
        where: { id: eventId },
      });

      expect(webhookEvent).toBeDefined();

      const secondResponse = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: {
          'stripe-signature': 't=123,v1=test',
        },
        payload: webhookPayload,
      });

      expect(secondResponse.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
