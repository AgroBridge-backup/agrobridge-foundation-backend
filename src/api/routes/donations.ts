import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { verifyAdminToken } from '../../auth/jwt.js';
import { ok, fail } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { DisbursementRepository } from '../../repositories/disbursement-repo.js';
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

  // ===========================================================================
  // DONOR-FACING DISTRIBUTION (where did my money go?)
  //
  // Auth model: a valid admin JWT (admins see everything) OR a donor presenting
  // a `stripeSessionId` query param that matches the donation's stripeSessionId.
  // Donors have no User account; they get the session id from their Stripe
  // receipt, which acts as a capability token for their own donation.
  //
  // Never exposes recipientIdentifier to donors (only admin endpoints do).
  // ===========================================================================
  app.get('/donations/:id/distribution', async (req, reply) => {
    const { id } = req.params as { id: string };

    const idResult = z.string().uuid().safeParse(id);
    if (!idResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid donation ID format' });
    }

    const donation = await app.prisma.donation.findUnique({
      where: { id },
      select: { id: true, stripeSessionId: true },
    });
    if (!donation) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Donation not found' });
    }

    // Auth: admin JWT OR donor with a matching stripeSessionId capability.
    const isAdmin = (await verifyAdminToken(req)) !== null;
    const query = req.query as { stripeSessionId?: string };
    const donorAuthorized =
      !!donation.stripeSessionId &&
      typeof query.stripeSessionId === 'string' &&
      query.stripeSessionId === donation.stripeSessionId;

    if (!isAdmin && !donorAuthorized) {
      reply.status(401);
      return fail({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }

    const repo = new DisbursementRepository(app.prisma);
    const distribution = await repo.findCompletedByDonationId(id);

    if (!distribution) {
      return ok({ disbursed: false });
    }

    const line = distribution.lines[0];
    return ok({
      disbursed: true,
      recipientName: distribution.recipientName,
      disbursedAt: distribution.disbursedAt,
      externalReference: distribution.externalReference,
      amount: line ? line.appliedAmount : 0,
      currency: distribution.currency,
    });
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

  return stripeService.createCheckoutSession(payload);
}
