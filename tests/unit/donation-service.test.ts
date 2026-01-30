import { describe, expect, it } from 'vitest';

import { DonationService } from '../../src/services/donation-service.js';

describe('DonationService', () => {
  it('validates amount > 0 and integer', async () => {
    const svc = new DonationService({ createPending: async () => ({ id: 'd1' }) } as any);

    await expect(svc.createDonationIntent({ amount: 0 })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });

    await expect(svc.createDonationIntent({ amount: 10.5 })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('defaults currency to usd and returns donationId', async () => {
    const svc = new DonationService({ createPending: async () => ({ id: 'd1' }) } as any);
    const res = await svc.createDonationIntent({ amount: 5000 });
    expect(res).toMatchObject({ donationId: 'd1', amount: 5000, currency: 'usd' });
  });
});
