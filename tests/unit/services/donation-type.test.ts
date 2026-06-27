import { describe, expect, test } from 'vitest';

import { DonationService } from '../../../src/services/donation-service.js';
import type { DonationRepository } from '../../../src/repositories/donation-repo.js';

/**
 * Regression for an audit finding: DonationService.createDonationIntent computed
 * `type` (ONE_TIME vs RECURRING) and even traced it, but never passed it to
 * createPending — so every donation was stored as ONE_TIME, including monthly
 * recurring gifts. This matters for recurring-donation reporting, where the
 * originating subscription payment must be RECURRING just like its renewals.
 */
function makeRecordingRepo() {
  const calls: Array<Record<string, unknown>> = [];
  const repo = {
    createPending: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { id: 'donation-1', ...input };
    },
  } as unknown as DonationRepository;
  return { repo, calls };
}

describe('DonationService.createDonationIntent — type persistence', () => {
  test('monthly frequency is persisted as type=RECURRING', async () => {
    const { repo, calls } = makeRecordingRepo();
    const service = new DonationService(repo);

    await service.createDonationIntent({ amount: 5000, currency: 'usd', frequency: 'monthly' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe('RECURRING');
  });

  test('one-time (default) frequency is persisted as type=ONE_TIME', async () => {
    const { repo, calls } = makeRecordingRepo();
    const service = new DonationService(repo);

    await service.createDonationIntent({ amount: 1000 });

    expect(calls[0]?.type).toBe('ONE_TIME');
  });

  test('explicit one-time frequency is persisted as type=ONE_TIME', async () => {
    const { repo, calls } = makeRecordingRepo();
    const service = new DonationService(repo);

    await service.createDonationIntent({ amount: 2500, frequency: 'one-time' });

    expect(calls[0]?.type).toBe('ONE_TIME');
  });
});
