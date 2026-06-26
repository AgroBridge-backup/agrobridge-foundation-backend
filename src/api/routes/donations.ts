import type { FastifyInstance } from 'fastify';

import { ok, fail } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { DonationService } from '../../services/donation-service.js';
import { StripeService } from '../../services/stripe-service.js';
import { getIdempotencyService, IdempotencyService } from '../../services/idempotency-service.js';
import {
  getAllowedDonationRedirectOrigins,
  validateRedirectUrl,
} from '../../utils/redirect-url.js';

export async function donationRoutes(app: FastifyInstance) {
  app.post('/donations/intent', async (req, reply) => {
    // --- Idempotency check ---
    // Prevents duplicate Stripe checkout sessions from double-clicks,
    // network retries, or concurrent requests with the same key.
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (idempotencyKey) {
      if (!IdempotencyService.isValidKey(idempotencyKey)) {
        reply.status(400);
        return fail({
          code: 'VALIDATION_ERROR',
          message: 'Idempotency-Key must be a valid UUID v4',
        });
      }

      const idempotencyService = getIdempotencyService();
      const result = await idempotencyService.execute(idempotencyKey, async () => {
        const session = await createDonationSession(app, req);
        return { status: 200, body: ok(session) };
      });

      reply.status(result.status);
      return result.body;
    }

    // No idempotency key — execute directly (backwards compatible)
    const session = await createDonationSession(app, req);
    return ok(session);
  });
}

/**
 * Core donation session creation logic, extracted for idempotency wrapping.
 */
async function createDonationSession(app: FastifyInstance, req: any) {
  const donationService = new DonationService(new DonationRepository(app.prisma));
  const intent = await donationService.createDonationIntent(req.body);

  const allowedOrigins = getAllowedDonationRedirectOrigins(app.env);
  const defaultOrigin = allowedOrigins[0] ?? 'http://localhost:3000';

  const defaultSuccessUrl = `${defaultOrigin}/donation/success?session_id={CHECKOUT_SESSION_ID}`;
  const defaultCancelUrl = `${defaultOrigin}/donation/cancel`;

  const resolvedSuccessUrl = validateRedirectUrl({
    candidateUrl: intent.successUrl,
    defaultUrl: defaultSuccessUrl,
    allowedOrigins,
    requireHttps: app.env.NODE_ENV === 'production',
    fieldName: 'successUrl',
    allowedPathPrefixes: ['/donation/success'],
    log: req.log,
  });

  const resolvedCancelUrl = validateRedirectUrl({
    candidateUrl: intent.cancelUrl,
    defaultUrl: defaultCancelUrl,
    allowedOrigins,
    requireHttps: app.env.NODE_ENV === 'production',
    fieldName: 'cancelUrl',
    allowedPathPrefixes: ['/donation/cancel'],
    log: req.log,
  });

  const stripeService = new StripeService(app.stripe, new DonationRepository(app.prisma));

  // Forward the client's idempotency key to Stripe so dedupe is enforced at the
  // payment source (independent of our Redis layer). Only UUID v4 keys reach here
  // — see IdempotencyService.isValidKey validation in the route.
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  const payload: {
    donationId: string;
    amount: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    frequency: 'one-time' | 'monthly';
    donorEmail?: string;
    metadata?: Record<string, string | number | boolean>;
    idempotencyKey?: string;
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
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

  return stripeService.createCheckoutSession(payload);
}
