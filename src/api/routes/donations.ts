import type { FastifyInstance } from 'fastify';

import { ok } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { DonationService } from '../../services/donation-service.js';
import { StripeService } from '../../services/stripe-service.js';

export async function donationRoutes(app: FastifyInstance) {
  app.post('/donations/intent', async (req) => {
    const donationService = new DonationService(new DonationRepository(app.prisma));
    const intent = await donationService.createDonationIntent(req.body);

    // Use frontend-provided URLs if available, otherwise fall back to CORS_ORIGIN
    const successOrigin = app.env.CORS_ORIGIN.split(',')[0]?.trim() ?? '';
    const resolvedSuccessUrl = intent.successUrl ?? `${successOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}`;
    const resolvedCancelUrl = intent.cancelUrl ?? `${successOrigin}/donation/cancel`;

    const stripeService = new StripeService(app.stripe, new DonationRepository(app.prisma));

    const payload: {
      donationId: string;
      amount: number;
      currency: string;
      successUrl: string;
      cancelUrl: string;
      frequency: 'one-time' | 'monthly';
      donorEmail?: string;
      metadata?: Record<string, string | number | boolean>;
    } = {
      donationId: intent.donationId,
      amount: intent.amount,
      currency: intent.currency,
      successUrl: resolvedSuccessUrl,
      cancelUrl: resolvedCancelUrl,
      frequency: intent.frequency,
    };

    if (intent.donorEmail) payload.donorEmail = intent.donorEmail;
    if (intent.metadata) payload.metadata = intent.metadata;

    const session = await stripeService.createCheckoutSession(payload);

    return ok(session);
  });
}
