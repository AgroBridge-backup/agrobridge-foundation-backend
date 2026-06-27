import { describe, expect, it, beforeEach, vi } from 'vitest';
import { DonationRepository } from '../../../src/repositories/donation-repo.js';
import { createMockPrismaClient } from '../../mocks/prisma-mock.js';

/**
 * Exact-once claim semantics for the donation webhook pipeline (audit finding:
 * the prior design treated an event row's existence as "processed", so a crash
 * after insert permanently skipped the event on Stripe retry). Both
 * transactionalStatusUpdate and createRenewal now claim the event
 * (processed false→true) inside the same transaction as the work; a redundant
 * run that finds the event already processed skips via claim.count === 0.
 *
 * The shared prisma-mock's $transaction does not invoke its callback by
 * default, so each test wires it to execute the callback with the mock client.
 */
describe('Donation webhook claim — exact-once under redelivery', () => {
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let repo: DonationRepository;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    repo = new DonationRepository(mockPrisma);
    vi.clearAllMocks();
    // Execute the interactive $transaction callback with the mock client.
    (mockPrisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => cb(mockPrisma),
    );
  });

  describe('transactionalStatusUpdate', () => {
    it('updates donation status when the event is claimed (first processing)', async () => {
      (mockPrisma.webhookEvent.updateMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 1,
      });

      await repo.transactionalStatusUpdate('cs_1', 'SUCCEEDED', 'evt_1', 'sub_9');

      const updateMany = mockPrisma.donation.updateMany as unknown as ReturnType<typeof vi.fn>;
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { stripeSessionId: 'cs_1' },
        data: { status: 'SUCCEEDED', stripeSubscriptionId: 'sub_9' },
      });
    });

    it('skips the status update when the event was already processed (claim lost)', async () => {
      // A retry after a successful prior run: processed is already true, so the
      // claim updateMany matches 0 rows and we must NOT touch the donation again.
      (mockPrisma.webhookEvent.updateMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      await repo.transactionalStatusUpdate('cs_1', 'SUCCEEDED', 'evt_1');

      expect(mockPrisma.donation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('createRenewal', () => {
    it('creates the renewal when the event is claimed (first processing)', async () => {
      (mockPrisma.webhookEvent.updateMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 1,
      });

      const result = await repo.createRenewal(
        { amount: 2500, currency: 'usd', stripeSubscriptionId: 'sub_9' },
        'evt_renew_1',
      );

      const create = mockPrisma.donation.create as unknown as ReturnType<typeof vi.fn>;
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 2500,
          status: 'SUCCEEDED',
          type: 'RECURRING',
          stripeSubscriptionId: 'sub_9',
        }),
      });
      expect(result).toEqual({ alreadyProcessed: false });
    });

    it('does NOT create a duplicate renewal when the event was already processed', async () => {
      // The exact-once guarantee: a redelivered invoice.paid must not insert a
      // second renewal row.
      (mockPrisma.webhookEvent.updateMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      const result = await repo.createRenewal(
        { amount: 2500, currency: 'usd', stripeSubscriptionId: 'sub_9' },
        'evt_renew_1',
      );

      expect(mockPrisma.donation.create).not.toHaveBeenCalled();
      expect(result).toEqual({ alreadyProcessed: true });
    });
  });
});
