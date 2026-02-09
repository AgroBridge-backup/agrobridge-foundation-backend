import { trace } from '@opentelemetry/api';
import type Stripe from 'stripe';

import { DonationRepository } from '../repositories/donation-repo.js';

export class StripeService {
  constructor(private readonly stripe: Stripe, private readonly donations: DonationRepository) {}

  async createCheckoutSession(input: {
    donationId: string;
    amount: number;
    currency: string;
    frequency: 'one-time' | 'monthly';
    donorEmail?: string;
    metadata?: Record<string, string | number | boolean>;
    successUrl: string;
    cancelUrl: string;
  }) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('stripe.checkout.create_session', async (span) => {
      try {
        span.setAttribute('donation.id', input.donationId);
        span.setAttribute('donation.amount', input.amount);
        span.setAttribute('donation.currency', input.currency);
        span.setAttribute('donation.frequency', input.frequency);

        const isRecurring = input.frequency === 'monthly';

        const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
          currency: input.currency,
          product_data: {
            name: isRecurring ? 'Monthly Donation' : 'Donation',
          },
          unit_amount: input.amount,
        };

        if (isRecurring) {
          priceData.recurring = { interval: 'month' };
        }

        const createParams: Stripe.Checkout.SessionCreateParams = {
          mode: isRecurring ? 'subscription' : 'payment',
          line_items: [
            {
              price_data: priceData,
              quantity: 1,
            },
          ],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          metadata: {
            donationId: input.donationId,
            source: 'agrobridgefoundation.org',
            ...Object.fromEntries(
              Object.entries(input.metadata ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
            ),
          },
        };

        if (input.donorEmail) createParams.customer_email = input.donorEmail;

        const session = await this.stripe.checkout.sessions.create(createParams);

        span.setAttribute('stripe.checkout.session_id', session.id);

        await this.donations.attachStripeSession(input.donationId, session.id);

        return { sessionId: session.id, url: session.url };
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
