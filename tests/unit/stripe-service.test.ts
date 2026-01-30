import { describe, expect, it } from 'vitest';

import { StripeService } from '../../src/services/stripe-service.js';

describe('StripeService', () => {
  it('creates checkout session and persists session id', async () => {
    let attached: { donationId: string; sessionId: string } | undefined;

    const stripe = {
      checkout: {
        sessions: {
          create: async () => ({ id: 'cs_123', url: 'https://stripe.test/checkout/cs_123' }),
        },
      },
    } as unknown as StripeService['stripe'];

    const donations = {
      attachStripeSession: async (donationId: string, stripeSessionId: string) => {
        attached = { donationId, sessionId: stripeSessionId };
        return { id: donationId };
      },
    } as unknown as StripeService['donations'];

    const svc = new StripeService(stripe, donations);

    const res = await svc.createCheckoutSession({
      donationId: 'd1',
      amount: 5000,
      currency: 'usd',
      successUrl: 'https://example.com/s',
      cancelUrl: 'https://example.com/c',
    });

    expect(attached).toEqual({ donationId: 'd1', sessionId: 'cs_123' });
    expect(res).toEqual({ sessionId: 'cs_123', url: 'https://stripe.test/checkout/cs_123' });
  });
});
