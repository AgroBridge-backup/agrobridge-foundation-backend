import { trace, type Span } from '@opentelemetry/api';
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

          // Capture the subscription id for recurring donations so that
          // renewals (invoice.paid) can be linked back to this Donation.
          const subscriptionId =
            typeof session.subscription === 'string' ? session.subscription : undefined;

          await this.donations.transactionalStatusUpdate(
            session.id,
            status,
            event.id,
            subscriptionId,
          );
        } else if (event.type === 'invoice.paid') {
          // Recurring donation renewal. Each successful renewal (cycle) creates
          // a new SUCCEEDED Donation row of type RECURRING, linked to the
          // original donor/campaign via the subscription id.
          await this.handleInvoicePaid(event, span);
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

  /**
   * Process an invoice.paid event for recurring donation renewals.
   *
   * Double-count guard: Stripe fires invoice.paid for the FIRST subscription
   * invoice too, but that payment is already represented by the original
   * Donation transitioning to SUCCEEDED via checkout.session.completed. So we
   * only create a renewal row for true cycles (billing_reason='subscription_cycle').
   */
  private async handleInvoicePaid(event: Stripe.Event, span: Span): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    span.setAttribute('stripe.invoice.id', invoice.id);
    span.setAttribute('stripe.invoice.amount_paid', invoice.amount_paid);
    span.setAttribute('stripe.invoice.billing_reason', invoice.billing_reason ?? 'unknown');

    // Only genuine renewal cycles create a new Donation row. The first invoice
    // ('subscription_create') is already covered by checkout.session.completed.
    if (invoice.billing_reason !== 'subscription_cycle') {
      await this.events.markProcessed(event.id);
      return;
    }

    // Ignore zero-amount invoices (credits, proration offsets, etc.).
    if (!invoice.amount_paid || invoice.amount_paid <= 0) {
      await this.events.markProcessed(event.id);
      return;
    }

    const subscriptionId = extractSubscriptionId(invoice);

    // Build the renewal input without explicit `undefined` (exactOptionalPropertyTypes).
    const input: {
      amount: number;
      currency: string;
      donorEmail?: string;
      donorName?: string;
      campaignId?: string;
      stripeSubscriptionId?: string;
    } = {
      amount: invoice.amount_paid,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
    };

    // Link the renewal to the original donor + campaign via the subscription.
    if (subscriptionId) {
      input.stripeSubscriptionId = subscriptionId;
      const original = await this.donations.findByStripeSubscriptionId(subscriptionId);
      if (original) {
        if (original.donorEmail) input.donorEmail = original.donorEmail;
        if (original.donorName) input.donorName = original.donorName;
        if (original.campaignId) input.campaignId = original.campaignId;
      }
    }

    await this.donations.createRenewal(input, event.id);
  }
}

/**
 * Extract a subscription id from an invoice across Stripe API versions.
 *
 * In the pinned version (2024-12-18.acacia) the typed path is
 * `invoice.parent.subscription_details.subscription`. Older account/endpoint
 * versions still echo a top-level `invoice.subscription`; we read both because
 * webhook payloads are shaped by the endpoint's configured API version, which
 * may differ from the SDK's.
 */
function extractSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (sub) return typeof sub === 'string' ? sub : sub.id;
  const legacy = (invoice as unknown as { subscription?: string | { id?: string } }).subscription;
  if (typeof legacy === 'string') return legacy;
  if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string') return legacy.id;
  return undefined;
}
