import { trace } from '@opentelemetry/api';
import type Stripe from 'stripe';

import { Errors } from '../errors/app-error.js';
import { DonationRepository } from '../repositories/donation-repo.js';
import { WebhookEventRepository } from '../repositories/webhook-event-repo.js';

export class StripeWebhookHandler {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
    private readonly events: WebhookEventRepository,
    private readonly donations: DonationRepository,
  ) {}

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new Error('Invalid Stripe signature');
    }
  }

  async handle(rawBody: Buffer, signature: string) {
    const tracer = trace.getTracer('agrobridge.webhooks');

    return tracer.startActiveSpan('stripe.webhook.handle', async (span) => {
      try {
        const event = this.constructEvent(rawBody, signature);

        span.setAttribute('stripe.event.id', event.id);
        span.setAttribute('stripe.event.type', event.type);

        const rawPayload = rawBody.toString('utf8');
        const created = await this.events.createIfNotExists({
          id: event.id,
          type: event.type,
          rawPayload,
        });

        if (created.alreadyProcessed) {
          span.setAttribute('stripe.webhook.idempotent', true);
          return { idempotent: true };
        }

        if (
          event.type === 'checkout.session.completed' ||
          event.type === 'checkout.session.expired'
        ) {
          const session = event.data.object as Stripe.Checkout.Session;
          if (!session.id) throw Errors.validation({ message: 'Missing session id' });

          span.setAttribute('stripe.checkout.session_id', session.id);

          if (event.type === 'checkout.session.completed') {
            await this.donations.updateStatusByStripeSessionId(session.id, 'SUCCEEDED');
          } else {
            await this.donations.updateStatusByStripeSessionId(session.id, 'EXPIRED');
          }
        }

        await this.events.markProcessed(event.id);

        return { idempotent: false };
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
