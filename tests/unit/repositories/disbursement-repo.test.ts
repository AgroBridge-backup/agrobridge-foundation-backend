import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';

import { DisbursementRepository } from '../../../src/repositories/disbursement-repo.js';

/**
 * Local mock that supports the Disbursement delegate AND interactive
 * $transaction(async (tx) => ...) by handing the callback the same mock as tx.
 * (The shared tests/mocks/prisma-mock.ts predates Disbursements and has no
 * disbursement delegate; rather than mutate it, we build a focused mock here.)
 */
function createDisbursementMockPrisma() {
  const mock = {
    disbursement: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    donation: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(mock);
      // batch array form (listPaged) — resolve each promise
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  return mock as unknown as PrismaClient & {
    disbursement: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    donation: { findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

const DISBURSEMENT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_SUB = '00000000-0000-4000-8000-000000000099';

describe('DisbursementRepository', () => {
  let prisma: ReturnType<typeof createDisbursementMockPrisma>;
  let repo: DisbursementRepository;

  beforeEach(() => {
    prisma = createDisbursementMockPrisma();
    repo = new DisbursementRepository(prisma);
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('translates a P2002 unique violation (@@unique([donationId])) into a 409 CONFLICT, not a 500', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`donationId`)',
        { code: 'P2002', clientVersion: '7.2.0' },
      );
      prisma.disbursement.create.mockRejectedValue(p2002);

      await expect(
        repo.create({
          amount: 5000,
          currency: 'usd',
          recipientName: 'Producer A',
          recipientIdentifier: 'iban:...',
          method: 'BANK_TRANSFER',
          status: 'COMPLETED',
          lines: [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5000 }],
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    });

    it('re-throws non-P2002 errors unchanged', async () => {
      const other = new Prisma.PrismaClientKnownRequestError('fk violation', {
        code: 'P2003',
        clientVersion: '7.2.0',
      });
      prisma.disbursement.create.mockRejectedValue(other);

      await expect(
        repo.create({
          amount: 5000,
          currency: 'usd',
          recipientName: 'Producer A',
          recipientIdentifier: 'iban:...',
          method: 'BANK_TRANSFER',
          status: 'COMPLETED',
          lines: [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5000 }],
        }),
      ).rejects.toBe(other);
    });

    it('writes through the provided transaction client (so create is atomic with validation)', async () => {
      const created = { id: DISBURSEMENT_ID };
      prisma.disbursement.create.mockResolvedValue(created);

      const result = await repo.create(
        {
          amount: 5000,
          currency: 'usd',
          recipientName: 'Producer A',
          recipientIdentifier: 'iban:...',
          method: 'BANK_TRANSFER',
          status: 'COMPLETED',
          createdBy: ADMIN_SUB,
          lines: [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5000 }],
        },
        prisma, // simulate the tx client passed by the route
      );

      expect(result).toBe(created);
      expect(prisma.disbursement.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus (state machine + audit trail)', () => {
    it('rejects an illegal transition (REVERSED -> COMPLETED) with a 409 CONFLICT and does not write', async () => {
      prisma.disbursement.findUnique.mockResolvedValue({
        status: 'REVERSED',
        statusHistory: [],
        disbursedAt: null,
      });

      await expect(
        repo.updateStatus(DISBURSEMENT_ID, 'COMPLETED', { by: ADMIN_SUB }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

      expect(prisma.disbursement.update).not.toHaveBeenCalled();
    });

    it('rejects a no-op same-status transition (COMPLETED -> COMPLETED)', async () => {
      prisma.disbursement.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        statusHistory: [],
        disbursedAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(
        repo.updateStatus(DISBURSEMENT_ID, 'COMPLETED', { by: ADMIN_SUB }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    });

    it('throws 404 NOT_FOUND when the disbursement does not exist', async () => {
      prisma.disbursement.findUnique.mockResolvedValue(null);

      await expect(
        repo.updateStatus(DISBURSEMENT_ID, 'COMPLETED', { by: ADMIN_SUB }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('on PENDING -> COMPLETED stamps disbursedAt (now) and appends an audit entry', async () => {
      const updated = { id: DISBURSEMENT_ID, status: 'COMPLETED' };
      prisma.disbursement.findUnique.mockResolvedValue({
        status: 'PENDING',
        statusHistory: [],
        disbursedAt: null,
      });
      prisma.disbursement.update.mockResolvedValue(updated);

      const before = Date.now();
      const result = await repo.updateStatus(DISBURSEMENT_ID, 'COMPLETED', { by: ADMIN_SUB });
      const after = Date.now();

      expect(result).toBe(updated);
      expect(prisma.disbursement.update).toHaveBeenCalledTimes(1);
      const call = prisma.disbursement.update.mock.calls[0]![0] as {
        where: { id: string };
        data: { status: string; disbursedAt: Date; statusHistory: Array<Record<string, unknown>> };
      };

      expect(call.where.id).toBe(DISBURSEMENT_ID);
      expect(call.data.status).toBe('COMPLETED');
      // disbursedAt stamped to ~now (no stale value carried from the PENDING row)
      expect(call.data.disbursedAt).toBeInstanceOf(Date);
      expect(call.data.disbursedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.data.disbursedAt.getTime()).toBeLessThanOrEqual(after);

      // audit entry
      expect(call.data.statusHistory).toHaveLength(1);
      expect(call.data.statusHistory[0]).toMatchObject({
        from: 'PENDING',
        to: 'COMPLETED',
        by: ADMIN_SUB,
      });
      expect(typeof call.data.statusHistory[0]!['at']).toBe('string');
    });

    it('on COMPLETED -> REVERSED clears disbursedAt and appends an audit entry', async () => {
      const priorHistory = [
        { from: 'PENDING', to: 'COMPLETED', at: '2026-06-20T00:00:00.000Z', by: ADMIN_SUB },
      ];
      prisma.disbursement.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        statusHistory: priorHistory,
        disbursedAt: new Date('2026-06-20T00:00:00Z'),
      });
      prisma.disbursement.update.mockResolvedValue({ id: DISBURSEMENT_ID, status: 'REVERSED' });

      await repo.updateStatus(DISBURSEMENT_ID, 'REVERSED', { by: ADMIN_SUB });

      const call = prisma.disbursement.update.mock.calls[0]![0] as {
        data: { status: string; disbursedAt: Date | null; statusHistory: Array<Record<string, unknown>> };
      };

      expect(call.data.status).toBe('REVERSED');
      // reversal clears the stale stamp — funds did not stay out
      expect(call.data.disbursedAt).toBeNull();
      // prior audit history preserved + new entry appended
      expect(call.data.statusHistory).toHaveLength(2);
      expect(call.data.statusHistory[1]).toMatchObject({
        from: 'COMPLETED',
        to: 'REVERSED',
        by: ADMIN_SUB,
      });
    });

    it('treats null statusHistory as [] when appending (no default needed in schema)', async () => {
      prisma.disbursement.findUnique.mockResolvedValue({
        status: 'PENDING',
        statusHistory: null,
        disbursedAt: null,
      });
      prisma.disbursement.update.mockResolvedValue({ id: DISBURSEMENT_ID, status: 'FAILED' });

      await repo.updateStatus(DISBURSEMENT_ID, 'FAILED', { by: ADMIN_SUB });

      const call = prisma.disbursement.update.mock.calls[0]![0] as {
        data: { statusHistory: Array<Record<string, unknown>> };
      };
      expect(call.data.statusHistory).toHaveLength(1);
      expect(call.data.statusHistory[0]).toMatchObject({ from: 'PENDING', to: 'FAILED' });
    });
  });
});
