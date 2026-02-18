import { describe, expect, it, vi } from 'vitest';

import { createContractApp, createContractRouteApp } from '../../contracts/lib/contract-app.js';
import { contactRoutes } from '../../src/api/routes/contacts.js';
import { donationRoutes } from '../../src/api/routes/donations.js';
import { healthRoutes } from '../../src/api/routes/health.js';
import { ContactService } from '../../src/services/contact-service.js';
import { DonationService } from '../../src/services/donation-service.js';
import { StripeService } from '../../src/services/stripe-service.js';

describe('Synthetic endpoint checks', () => {
  it('GET /api/health returns healthy payload when dependency check passes', async () => {
    const app = createContractApp();
    (app as any).prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    await app.register(healthRoutes, { prefix: '/api' });
    await app.ready();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        data: { status: 'ok', db: 'ok' },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /api/donations/intent succeeds on synthetic request', async () => {
    vi.spyOn(DonationService.prototype, 'createDonationIntent').mockResolvedValue({
      donationId: 'synthetic-donation-1',
      amount: 2500,
      currency: 'usd',
      donorEmail: 'synthetic@example.com',
      donorName: null,
      isAnonymous: false,
      message: null,
      frequency: 'one-time',
      type: 'ONE_TIME',
      successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://example.com/cancel',
      source: 'synthetic-check',
    } as Awaited<ReturnType<DonationService['createDonationIntent']>>);

    vi.spyOn(StripeService.prototype, 'createCheckoutSession').mockResolvedValue({
      sessionId: 'cs_synthetic_1',
      url: 'https://checkout.stripe.test/cs_synthetic_1',
    });

    const app = await createContractRouteApp(donationRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/donations/intent',
        payload: {
          amount: 2500,
          currency: 'usd',
          frequency: 'one-time',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        data: {
          sessionId: 'cs_synthetic_1',
          url: 'https://checkout.stripe.test/cs_synthetic_1',
        },
      });
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });

  it('POST /api/contacts succeeds on synthetic request', async () => {
    vi.spyOn(ContactService.prototype, 'create').mockResolvedValue({
      id: 'synthetic-contact-1',
    });

    const app = await createContractRouteApp(contactRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'Synthetic Check',
          email: 'synthetic@example.com',
          message: 'Synthetic endpoint check for contacts',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        ok: true,
        data: { id: 'synthetic-contact-1' },
      });
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });
});
