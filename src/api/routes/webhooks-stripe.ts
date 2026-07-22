import type { FastifyInstance } from 'fastify';

import { ok } from '../../http/response.js';
import { DonationRepository } from '../../repositories/donation-repo.js';
import { WebhookEventRepository } from '../../repositories/webhook-event-repo.js';
import { StripeWebhookHandler } from '../../webhooks/stripe-webhook-handler.js';

export async function stripeWebhookRoutes(app: FastifyInstance) {
  app.post(
    '/webhooks/stripe',
    {
      config: {
        rawBody: true,
      },
    },
    async (req, reply) => {
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string') {
        reply.status(400);
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Missing stripe-signature' },
        };
      }

      const rawBody = req.rawBody;
      if (!rawBody) {
        reply.status(400);
        return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Missing raw body' } };
      }
      const payloadBuffer =
        typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;

      const handler = new StripeWebhookHandler(
        app.stripe,
        app.env.STRIPE_WEBHOOK_SECRET,
        new WebhookEventRepository(app.prisma),
        new DonationRepository(app.prisma),
      );

      try {
        await handler.handle(payloadBuffer, signature);
      } catch (err) {
        if (err instanceof Error && err.message === 'Invalid Stripe signature') {
          reply.status(400);
          return {
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid Stripe signature' },
          };
        }
        throw err;
      }

      reply.status(200);
      return ok({});
    },
  );
}
