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
  ) { }

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

        // Replay protection: reject events older than 5 minutes
        // Stripe event timestamps are in seconds
        const eventAgeMs = (Date.now() / 1000 - event.created) * 1000;
        const MAX_EVENT_AGE_MS = 5 * 60 * 1000; // 5 minutes
        if (eventAgeMs > MAX_EVENT_AGE_MS) {
          span.setAttribute('stripe.webhook.replay_rejected', true);
          span.setAttribute('stripe.webhook.event_age_ms', eventAgeMs);
          throw Errors.validation({
            message: 'Webhook event too old (possible replay attack)',
            eventAge: Math.round(eventAgeMs / 1000),
          });
        }

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

          // TRANSACTION BOUNDARY: Status update + event marked as processed
          // must be atomic. A crash between these two operations would leave
          // the donation in an inconsistent state with an unprocessed webhook.
          const status = event.type === 'checkout.session.completed' ? 'SUCCEEDED' : 'EXPIRED';
          await this.donations.transactionalStatusUpdate(
            session.id,
            status,
            event.id,
          );
        } else {
          // For non-checkout events, just mark as processed
          await this.events.markProcessed(event.id);
        }

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
