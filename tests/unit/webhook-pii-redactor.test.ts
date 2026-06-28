import { describe, it, expect } from 'vitest';

import { redactStripePayload } from '../../src/lib/webhook-pii-redactor.js';

describe('redactStripePayload', () => {
  it('returns the input unchanged when it is not valid JSON', () => {
    const raw = 'not-json';
    expect(redactStripePayload(raw)).toBe('not-json');
  });

  it('redacts customer email, billing_details, customer_details, and shipping', () => {
    const payload = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          amount_total: 5000,
          customer_email: 'donor@example.com',
          receipt_email: 'donor@example.com',
          customer_details: { email: 'donor@example.com', name: 'Donor', phone: '+12025550100' },
          billing_details: { email: 'donor@example.com', name: 'Donor' },
          shipping: { name: 'Donor', phone: '+12025550100', address: { line1: '1 Main St' } },
        },
      },
    };

    const out = JSON.parse(redactStripePayload(JSON.stringify(payload)));

    // Non-sensitive debugging fields are preserved.
    expect(out.id).toBe('evt_1');
    expect(out.type).toBe('checkout.session.completed');
    expect(out.data.object.id).toBe('cs_test_1');
    expect(out.data.object.amount_total).toBe(5000);

    // PII leaves are redacted.
    expect(out.data.object.customer_email).toBe('[REDACTED]');
    expect(out.data.object.receipt_email).toBe('[REDACTED]');

    // PII object blobs are redacted whole.
    expect(out.data.object.customer_details).toBe('[REDACTED]');
    expect(out.data.object.billing_details).toBe('[REDACTED]');
    expect(out.data.object.shipping).toBe('[REDACTED]');
  });

  it('redacts card fingerprint/bin but keeps brand and last4', () => {
    const payload = {
      id: 'evt_2',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          charges: {
            data: [
              {
                payment_method_details: {
                  card: {
                    brand: 'visa',
                    last4: '4242',
                    fingerprint: 'IPQ6yhA1TxqMHoVB',
                    bin: '424242',
                    funding: 'credit',
                  },
                },
              },
            ],
          },
        },
      },
    };

    const card = JSON.parse(redactStripePayload(JSON.stringify(payload))).data.object.charges
      .data[0].payment_method_details.card;

    expect(card.brand).toBe('visa');
    expect(card.last4).toBe('4242');
    expect(card.funding).toBe('credit');
    expect(card.fingerprint).toBe('[REDACTED]');
    expect(card.bin).toBe('[REDACTED]');
  });

  it('is stable for an input without any PII', () => {
    const payload = { id: 'evt_3', type: 'x', data: { object: { amount: 10 } } };
    const round = JSON.parse(redactStripePayload(JSON.stringify(payload)));
    expect(round).toEqual(payload);
  });
});
