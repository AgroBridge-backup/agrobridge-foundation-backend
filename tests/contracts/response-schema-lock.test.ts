import { afterEach, describe, expect, it, vi } from 'vitest';

import { createContractRouteApp } from '../../contracts/lib/contract-app.js';
import { postApiContactsResponseV1Schema } from '../../contracts/schemas/post-api-contacts.response.v1.js';
import { postApiDonationsIntentResponseV1Schema } from '../../contracts/schemas/post-api-donations-intent.response.v1.js';
import { contactRoutes } from '../../src/api/routes/contacts.js';
import { donationRoutes } from '../../src/api/routes/donations.js';
import { ContactService } from '../../src/services/contact-service.js';
import { DonationService } from '../../src/services/donation-service.js';
import { StripeService } from '../../src/services/stripe-service.js';

describe('API response schema locks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/donations/intent stays compatible with v1 response schema', async () => {
    vi.spyOn(DonationService.prototype, 'createDonationIntent').mockResolvedValue({
      donationId: '78b7c9d8-a0ec-4fa9-a9f6-5d31ddcc4025',
      amount: 5000,
      currency: 'usd',
      donorEmail: 'donor@example.com',
      donorName: 'Donor Example',
      isAnonymous: false,
      message: 'Keep growing',
      frequency: 'one-time',
      type: 'ONE_TIME',
      successUrl: 'https://example.com/donation/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://example.com/donation/cancel',
      source: 'contract-test',
    } as Awaited<ReturnType<DonationService['createDonationIntent']>>);

    vi.spyOn(StripeService.prototype, 'createCheckoutSession').mockResolvedValue({
      sessionId: 'cs_test_contract_123',
      url: null,
    });

    const app = await createContractRouteApp(donationRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/donations/intent',
        payload: {
          amount: 5000,
          currency: 'usd',
          frequency: 'one-time',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(() => postApiDonationsIntentResponseV1Schema.parse(response.json())).not.toThrow();
    } finally {
      await app.close();
    }
  });

  it('POST /api/contacts stays compatible with v1 response schema', async () => {
    vi.spyOn(ContactService.prototype, 'create').mockResolvedValue({
      id: 'contact_contract_123',
    });

    const app = await createContractRouteApp(contactRoutes);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'Contract Test',
          email: 'contact@example.com',
          message: 'Testing response schema lock.',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(() => postApiContactsResponseV1Schema.parse(response.json())).not.toThrow();
    } finally {
      await app.close();
    }
  });
});
