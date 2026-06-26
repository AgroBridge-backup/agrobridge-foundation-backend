import { describe, expect, test } from 'vitest';
import type Stripe from 'stripe';

import { StripeWebhookHandler } from '../../../src/webhooks/stripe-webhook-handler.js';
import type { DonationRepository } from '../../../src/repositories/donation-repo.js';
import type { WebhookEventRepository } from '../../../src/repositories/webhook-event-repo.js';

/**
 * Recurring-donation webhook handling.
 *
 * Model A (decided): each successful renewal (invoice.paid, billing_reason=
 * subscription_cycle) creates a new SUCCEEDED Donation row of type RECURRING,
 * inheriting donor/campaign from the original subscription Donation. The first
 * invoice (subscription_create) must NOT create a row — it is already covered
 * by checkout.session.completed, which would otherwise double-count.
 *
 * These tests drive StripeWebhookHandler with fake repos + a stubbed
 * constructEvent (no Stripe/DB required).
 */

type TxStatusCall = { sessionId: string; status: string; eventId: string; subscriptionId?: string };
type RenewalCall = { input: Record<string, unknown>; eventId: string };

interface Fakes {
  donations: DonationRepository;
  events: WebhookEventRepository;
  txStatus: TxStatusCall[];
  renewals: RenewalCall[];
  markProcessed: string[];
}

function makeFakes(original?: {
  donorEmail: string | null;
  donorName: string | null;
  campaignId: string | null;
}): Fakes {
  const txStatus: TxStatusCall[] = [];
  const renewals: RenewalCall[] = [];
  const markProcessed: string[] = [];

  const donations = {
    transactionalStatusUpdate: async (
      sessionId: string,
      status: string,
      eventId: string,
      subscriptionId?: string,
    ) => {
      txStatus.push({ sessionId, status, eventId, subscriptionId });
    },
    findByStripeSubscriptionId: async (_subId: string) =>
      original
        ? { donorEmail: original.donorEmail, donorName: original.donorName, campaignId: original.campaignId, deletedAt: null }
        : null,
    createRenewal: async (input: Record<string, unknown>, eventId: string) => {
      renewals.push({ input, eventId });
    },
  } as unknown as DonationRepository;

  const events = {
    createIfNotExists: async ({ id }: { id: string; type: string; rawPayload: string }) => ({
      created: { id, type: '', rawPayload: '', processed: false, createdAt: new Date() },
      alreadyProcessed: false,
    }),
    markProcessed: async (id: string) => {
      markProcessed.push(id);
    },
  } as unknown as WebhookEventRepository;

  return { donations, events, txStatus, renewals, markProcessed };
}

function makeHandler(fakes: Fakes, event: Stripe.Event): StripeWebhookHandler {
  const stripe = { webhooks: { constructEvent: () => event } } as unknown as Stripe;
  return new StripeWebhookHandler(stripe, 'whsec_test', fakes.events, fakes.donations);
}

const NOW = Math.floor(Date.now() / 1000);

function invoicePaid(overrides: Partial<{
  id: string;
  amountPaid: number;
  billingReason: string;
  subscription: string;
}>): Stripe.Event {
  const o = { id: 'evt_inv', amountPaid: 2500, billingReason: 'subscription_cycle', subscription: 'sub_1', ...overrides };
  return {
    id: o.id,
    type: 'invoice.paid',
    created: NOW,
    data: {
      object: {
        id: 'in_1',
        amount_paid: o.amountPaid,
        currency: 'usd',
        billing_reason: o.billingReason,
        parent: { subscription_details: { subscription: o.subscription } },
      },
    },
  } as unknown as Stripe.Event;
}

function checkoutCompleted(subscription?: string): Stripe.Event {
  return {
    id: 'evt_cs',
    type: 'checkout.session.completed',
    created: NOW,
    data: { object: { id: 'cs_1', ...(subscription ? { subscription } : {}) } },
  } as unknown as Stripe.Event;
}

describe('StripeWebhookHandler — recurring donations', () => {
  test('checkout.session.completed captures the subscription id for recurring gifts', async () => {
    const fakes = makeFakes();
    const handler = makeHandler(fakes, checkoutCompleted('sub_1'));
    await handler.handle(Buffer.from('{}'), 'sig');
    expect(fakes.txStatus).toHaveLength(1);
    expect(fakes.txStatus[0]).toMatchObject({
      sessionId: 'cs_1',
      status: 'SUCCEEDED',
      subscriptionId: 'sub_1',
    });
  });

  test('one-time checkout does NOT attach a subscription id', async () => {
    const fakes = makeFakes();
    const handler = makeHandler(fakes, checkoutCompleted());
    await handler.handle(Buffer.from('{}'), 'sig');
    expect(fakes.txStatus[0]?.subscriptionId).toBeUndefined();
  });

  test('invoice.paid (subscription_cycle) creates a renewal row linked to the original donor/campaign', async () => {
    const fakes = makeFakes({
      donorEmail: 'donor@example.com',
      donorName: 'Jane',
      campaignId: 'camp-1',
    });
    const handler = makeHandler(fakes, invoicePaid({ amountPaid: 2500 }));
    await handler.handle(Buffer.from('{}'), 'sig');

    expect(fakes.renewals).toHaveLength(1);
    expect(fakes.renewals[0]?.eventId).toBe('evt_inv');
    expect(fakes.renewals[0]?.input).toMatchObject({
      amount: 2500,
      currency: 'usd',
      stripeSubscriptionId: 'sub_1',
      donorEmail: 'donor@example.com',
      donorName: 'Jane',
      campaignId: 'camp-1',
    });
    // createRenewal owns marking the event processed — markProcessed must not run.
    expect(fakes.markProcessed).toHaveLength(0);
  });

  test('first subscription invoice (subscription_create) does NOT create a renewal (no double-count)', async () => {
    const fakes = makeFakes();
    const handler = makeHandler(fakes, invoicePaid({ billingReason: 'subscription_create' }));
    await handler.handle(Buffer.from('{}'), 'sig');
    expect(fakes.renewals).toHaveLength(0);
    expect(fakes.markProcessed).toEqual(['evt_inv']);
  });

  test('zero-amount cycle invoice does NOT create a renewal', async () => {
    const fakes = makeFakes();
    const handler = makeHandler(fakes, invoicePaid({ amountPaid: 0 }));
    await handler.handle(Buffer.from('{}'), 'sig');
    expect(fakes.renewals).toHaveLength(0);
    expect(fakes.markProcessed).toEqual(['evt_inv']);
  });

  test('renewal without a known original still records the payment (no donor/campaign)', async () => {
    const fakes = makeFakes(); // no original
    const handler = makeHandler(fakes, invoicePaid({ amountPaid: 1000 }));
    await handler.handle(Buffer.from('{}'), 'sig');
    expect(fakes.renewals).toHaveLength(1);
    expect(fakes.renewals[0]?.input).toMatchObject({
      amount: 1000,
      stripeSubscriptionId: 'sub_1',
    });
    expect(fakes.renewals[0]?.input).not.toHaveProperty('donorEmail');
  });
});
