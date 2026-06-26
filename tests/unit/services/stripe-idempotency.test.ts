import { describe, expect, test } from 'vitest';

import { StripeService } from '../../../src/services/stripe-service.js';
import type { DonationRepository } from '../../../src/repositories/donation-repo.js';

/**
 * §9.5 fix: when the client sends an Idempotency-Key, it must reach Stripe's
 * API as Stripe's own idempotency key — so dedupe is enforced at the payment
 * source, independent of the Redis idempotency layer (whose fail-open behavior
 * during a Redis outage would otherwise allow duplicate checkout sessions).
 */
function makeFakeStripe() {
  const calls: Array<{ params: unknown; options: unknown }> = [];
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: unknown, options?: unknown) => {
          calls.push({ params, options });
          return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/cs_test_123' };
        },
      },
    },
  };
  return { stripe, calls };
}

const baseInput = {
  donationId: 'd-1',
  amount: 5000,
  currency: 'usd',
  frequency: 'one-time' as const,
  successUrl: 'https://example.com/donation/success',
  cancelUrl: 'https://example.com/donation/cancel',
};

describe('StripeService.createCheckoutSession — idempotency key forwarding', () => {
  test('forwards idempotencyKey to Stripe as a request option', async () => {
    const { stripe, calls } = makeFakeStripe();
    const donations = { attachStripeSession: async () => ({}) } as unknown as DonationRepository;
    const service = new StripeService(stripe as never, donations);

    await service.createCheckoutSession({ ...baseInput, idempotencyKey: '11111111-1111-4111-8111-111111111111' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
  });

  test('omits the options arg entirely when no key is provided (backwards compatible)', async () => {
    const { stripe, calls } = makeFakeStripe();
    const donations = { attachStripeSession: async () => ({}) } as unknown as DonationRepository;
    const service = new StripeService(stripe as never, donations);

    await service.createCheckoutSession(baseInput);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toBeUndefined();
  });
});
