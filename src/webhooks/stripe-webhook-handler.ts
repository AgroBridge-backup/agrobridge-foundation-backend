import { trace, type Span } from '@opentelemetry/api';
import type Stripe from 'stripe';

import { Errors } from '../errors/app-error.js';
import { requestContext } from '../observability/request-context.js';
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

        // Replay protection is provided by Stripe's own signature timestamp
        // tolerance (enforced inside constructEvent above). A separate age check
        // here previously rejected legitimate Stripe retries delayed >5 min
        // (deploy, network blip, Stripe backlog), leaving paid donations stuck
        // in PENDING forever. Redundant and harmful — removed.

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
            'PENDING', // state-machine guard: only transition out of PENDING
          );
        } else if (event.type === 'invoice.paid') {
          // Recurring donation renewal. Each successful renewal (cycle) creates
          // a new SUCCEEDED Donation row of type RECURRING, linked to the
          // original donor/campaign via the subscription id.
          await this.handleInvoicePaid(event, span);
        } else if (event.type === 'charge.refunded') {
          await this.handleRefunded(event, span);
        } else if (event.type === 'charge.dispute.created') {
          await this.handleDisputeCreated(event, span);
        } else if (
          event.type === 'invoice.payment_failed' ||
          event.type === 'customer.subscription.deleted'
        ) {
          await this.handleTerminalSubscriptionEvent(event, span);
        } else {
          // Unhandled event type — mark processed so Stripe sees 200 and does
          // not retry indefinitely. Stripe emits many types we don't act on.
          span.setAttribute('stripe.webhook.unhandled_type', true);
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
      metadata?: Record<string, string>;
    } = {
      amount: invoice.amount_paid,
      currency: (invoice.currency ?? 'usd').toLowerCase(),
      // Carry the invoice id for forensic traceability (which invoice this renewal paid).
      metadata: { stripeInvoiceId: invoice.id },
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

  /**
   * Process charge.refunded: flip the donation SUCCEEDED → REFUNDED so
   * dashboards, donor reports, and disbursement eligibility reflect reality.
   * Maps the charge back to a donation via the checkout-session metadata that
   * Stripe propagates onto the charge (donationId set at session creation).
   */
  private async handleRefunded(event: Stripe.Event, span: Span): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    span.setAttribute('stripe.charge.id', charge.id);
    const donationId = charge.metadata?.donationId;
    if (!donationId) {
      // No reliable charge→donation mapping (metadata not propagated, e.g. a
      // donation created before this metadata was set). Surface and stop rather
      // than guess; the refund itself is already recorded by Stripe.
      span.setAttribute('stripe.refund.no_donation_mapping', true);
      requestContext.getLog()?.warn(
        { chargeId: charge.id, eventId: event.id },
        'charge.refunded: no donationId in charge metadata; cannot map to donation',
      );
      await this.events.markProcessed(event.id);
      return;
    }
    await this.donations.transactionalStatusUpdateById(
      donationId,
      'SUCCEEDED',
      'REFUNDED',
      event.id,
    );
  }

  /**
   * Process charge.dispute.created. The Dispute object references a charge id
   * but does not carry the checkout-session metadata, so we cannot map it to a
   * donation without an extra Stripe API call. For v1 we surface the dispute
   * (the founder-pager alerts on the logged warning) and mark it processed; a
   * follow-up can retrieve the charge and flip → DISPUTED.
   */
  private async handleDisputeCreated(event: Stripe.Event, span: Span): Promise<void> {
    const dispute = event.data.object as Stripe.Dispute;
    span.setAttribute('stripe.dispute.id', dispute.id);
    span.setAttribute('stripe.dispute.amount', dispute.amount);
    // TODO: retrieve dispute.charge → charge.metadata.donationId → flip to DISPUTED.
    requestContext.getLog()?.warn(
      { disputeId: dispute.id, chargeId: dispute.charge, eventId: event.id },
      'charge.dispute.created received — manual review required (DISPUTED transition not yet automated)',
    );
    await this.events.markProcessed(event.id);
  }

  /**
   * Handle terminal/failed recurring-payment signals: invoice.payment_failed
   * (renewal charge failed) and customer.subscription.deleted (cancellation).
   * No Donation row is created on failure/cancellation (renewals are only
   * created on successful invoice.paid), so for v1 we surface the event to the
   * founder-pager and mark it processed. A follow-up can flag the originating
   * donation to reflect churn/dunning.
   */
  private async handleTerminalSubscriptionEvent(event: Stripe.Event, span: Span): Promise<void> {
    const obj = event.data.object as { id?: string; subscription?: string | { id?: string } };
    const subscriptionId =
      typeof obj.subscription === 'string' ? obj.subscription : (obj.subscription?.id ?? obj.id);
    span.setAttribute('stripe.subscription.id', subscriptionId ?? 'unknown');
    // TODO: flag the originating donation as churned/failed once a status/flag exists.
    requestContext.getLog()?.warn(
      { eventType: event.type, subscriptionId, eventId: event.id },
      'Recurring lifecycle event received — dunning/churn handling not yet implemented',
    );
    await this.events.markProcessed(event.id);
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
