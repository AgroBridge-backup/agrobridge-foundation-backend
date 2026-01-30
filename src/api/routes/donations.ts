import type { FastifyInstance } from 'fastify';

import { ok } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { DonationService } from '../../services/donation-service.js';
import { StripeService } from '../../services/stripe-service.js';

export async function donationRoutes(app: FastifyInstance) {
  app.post('/donations/intent', async (req) => {
    const donationService = new DonationService(new DonationRepository(app.prisma));
    const { donationId, amount, currency, donorEmail, metadata } =
      await donationService.createDonationIntent(req.body);

    // In production, these should point to your website routes
    const successOrigin = app.env.CORS_ORIGIN.split(',')[0]?.trim() ?? '';
    const successUrl = `${successOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${successOrigin}/donation/cancel`;

    const stripeService = new StripeService(app.stripe, new DonationRepository(app.prisma));

    const payload: {
      donationId: string;
      amount: number;
      currency: string;
      successUrl: string;
      cancelUrl: string;
      donorEmail?: string;
      metadata?: Record<string, string | number | boolean>;
    } = { donationId, amount, currency, successUrl, cancelUrl };

    if (donorEmail) payload.donorEmail = donorEmail;
    if (metadata) payload.metadata = metadata;

    const session = await stripeService.createCheckoutSession(payload);

    return ok(session);
  });
}
