import { describe, expect, it } from 'vitest';

import { StripeWebhookHandler } from '../../src/webhooks/stripe-webhook-handler.js';

function makeHandler(opts?: {
  constructEvent?: any;
  createIfNotExists?: any;
  markProcessed?: any;
  transactionalStatusUpdate?: any;
}) {
  const stripe = {
    webhooks: {
      constructEvent:
        opts?.constructEvent ?? (() => ({ id: 'evt_1', type: 'noop', data: { object: {} } })),
    },
  } as unknown as StripeWebhookHandler['stripe'];

  const events = {
    createIfNotExists:
      opts?.createIfNotExists ??
      (async () => ({ created: { id: 'evt_1' }, alreadyProcessed: false })),
    markProcessed: opts?.markProcessed ?? (async () => ({})),
  } as unknown as StripeWebhookHandler['events'];

  const donations = {
    // Current handler API: atomic claim + status update.
    transactionalStatusUpdate:
      opts?.transactionalStatusUpdate ?? (async () => undefined),
  } as unknown as StripeWebhookHandler['donations'];

  return new StripeWebhookHandler(stripe, 'whsec_x', events, donations);
}

describe('StripeWebhookHandler', () => {
  it('returns idempotent if event already exists', async () => {
    const handler = makeHandler({
      createIfNotExists: async () => ({ created: null, alreadyProcessed: true }),
    });

    const res = await handler.handle(Buffer.from('{}'), 'sig');
    expect(res).toEqual({ idempotent: true });
  });

  it('marks donation succeeded on checkout.session.completed', async () => {
    let status: string | undefined;

    const handler = makeHandler({
      constructEvent: () => ({
        id: 'evt_2',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123' } },
      }),
      transactionalStatusUpdate: async (
        _sessionId: string,
        s: string,
        _eventId: string,
        _subscriptionId?: string,
      ) => {
        status = s;
      },
    });

    await handler.handle(Buffer.from('{"x":1}'), 'sig');
    expect(status).toBe('SUCCEEDED');
  });
});
