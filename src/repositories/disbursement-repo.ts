import { Prisma, PrismaClient } from '@prisma/client';

import { AppError } from '../errors/app-error.js';
import { withDbSpan } from '../observability/db-span.js';
import {
  type DisbursementStatus,
  isAllowedDisbursementTransition,
} from '../api/schemas/disbursements.schema.js';

// Accepts both the root client and an interactive transaction client so create
// can run inside a route-level $transaction that wraps validation + write.
type DbClient = PrismaClient | Prisma.TransactionClient;

export type DisbursementListFilters = {
  status?: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  method?: 'BANK_TRANSFER' | 'MANUAL_STRIPE' | 'OTHER';
  recipientName?: string;
  donationId?: string;
};

export type DisbursementListSort = {
  field: 'createdAt';
  direction: 'asc' | 'desc';
};

export class DisbursementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(
    input: {
      amount: number;
      currency: string;
      recipientName: string;
      recipientIdentifier: string;
      method: 'BANK_TRANSFER' | 'MANUAL_STRIPE' | 'OTHER';
      status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
      externalReference?: string;
      disbursedAt?: Date;
      notes?: string;
      metadata?: Prisma.InputJsonValue;
      createdBy?: string;
      lines: Array<{ donationId: string; appliedAmount: number }>;
    },
    client: DbClient = this.prisma,
  ) {
    return withDbSpan({
      name: 'db.disbursement.create',
      model: 'Disbursement',
      operation: 'create',
      fn: async () => {
        try {
          return await client.disbursement.create({
            data: {
              amount: input.amount,
              currency: input.currency,
              recipientName: input.recipientName,
              recipientIdentifier: input.recipientIdentifier,
              method: input.method,
              status: input.status,
              createdBy: input.createdBy ?? null,
              ...(input.externalReference ? { externalReference: input.externalReference } : {}),
              ...(input.disbursedAt ? { disbursedAt: input.disbursedAt } : {}),
              ...(input.notes ? { notes: input.notes } : {}),
              metadata: input.metadata ?? Prisma.JsonNull,
              lines: {
                create: input.lines.map((line) => ({
                  donationId: line.donationId,
                  appliedAmount: line.appliedAmount,
                })),
              },
            },
            include: { lines: true },
          });
        } catch (err) {
          // @@unique([donationId]) on DisbursementLine: a linked donation was
          // already disbursed by another record. Surface as a specific 409
          // rather than a generic 500 so the caller knows to stop, not retry.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new AppError({
              statusCode: 409,
              code: 'CONFLICT',
              message: 'One or more donations have already been disbursed',
            });
          }
          throw err;
        }
      },
    });
  }

  findById(id: string) {
    return withDbSpan({
      name: 'db.disbursement.find_by_id',
      model: 'Disbursement',
      operation: 'findUnique',
      fn: async () =>
        this.prisma.disbursement.findUnique({
          where: { id },
          include: { lines: { include: { donation: { select: { id: true, amount: true, currency: true, status: true } } } } },
        }),
    });
  }

  listPaged(input: {
    page: number;
    pageSize: number;
    filters: DisbursementListFilters;
    sort: DisbursementListSort;
  }) {
    return withDbSpan({
      name: 'db.disbursement.list_paged',
      model: 'Disbursement',
      operation: 'findMany+count',
      fn: async () => {
        const skip = (input.page - 1) * input.pageSize;
        const where: Prisma.DisbursementWhereInput = {
          ...(input.filters.status ? { status: input.filters.status } : {}),
          ...(input.filters.method ? { method: input.filters.method } : {}),
          ...(input.filters.recipientName
            ? { recipientName: { contains: input.filters.recipientName, mode: 'insensitive' } }
            : {}),
          ...(input.filters.donationId
            ? { lines: { some: { donationId: input.filters.donationId } } }
            : {}),
          deletedAt: null,
        };

        const orderBy = { [input.sort.field]: input.sort.direction } as const;

        return this.prisma.$transaction([
          this.prisma.disbursement.findMany({
            where,
            orderBy,
            skip,
            take: input.pageSize,
            include: { lines: true },
          }),
          this.prisma.disbursement.count({ where }),
        ]);
      },
    });
  }

  /**
   * Admin-only lookup: find the COMPLETED disbursement (if any) linked to a
   * donation. Selects only recipient-safe fields — never recipientIdentifier.
   * Retained from the donor-traceability design for admin reporting; the public
   * donor capability endpoint was removed (it relied on an unsigned
   * stripeSessionId that is not a true capability token — see PR #18 notes).
   */
  findCompletedByDonationId(donationId: string) {
    return withDbSpan({
      name: 'db.disbursement.find_completed_by_donation',
      model: 'Disbursement',
      operation: 'findFirst',
      fn: async () =>
        this.prisma.disbursement.findFirst({
          where: {
            status: 'COMPLETED',
            lines: { some: { donationId } },
            deletedAt: null,
          },
          select: {
            recipientName: true,
            externalReference: true,
            disbursedAt: true,
            currency: true,
            lines: {
              where: { donationId },
              select: { appliedAmount: true },
            },
          },
        }),
    });
  }

  updateStatus(
    id: string,
    status: DisbursementStatus,
    opts: { by?: string | null } = {},
  ) {
    return withDbSpan({
      name: 'db.disbursement.update_status',
      model: 'Disbursement',
      operation: 'transaction',
      fn: async () =>
        this.prisma.$transaction(async (tx) => {
          const existing = await tx.disbursement.findUnique({
            where: { id },
            select: { status: true, statusHistory: true, disbursedAt: true },
          });
          if (!existing) {
            throw new AppError({
              statusCode: 404,
              code: 'NOT_FOUND',
              message: 'Disbursement not found',
            });
          }

          const from = existing.status as DisbursementStatus;

          // State machine: reject illegal transitions with a 409. A no-op
          // (from === to) is also illegal — re-stamping is not allowed.
          if (from === status || !isAllowedDisbursementTransition(from, status)) {
            throw new AppError({
              statusCode: 409,
              code: 'CONFLICT',
              message: `Illegal status transition: ${from} → ${status}`,
            });
          }

          // disbursedAt bookkeeping:
          //  - COMPLETED: stamp now if not already set (idempotent on retries).
          //  - REVERSED: clear (a reversal means funds did NOT stay out).
          //  - other transitions: leave the existing value untouched.
          let nextDisbursedAt: Date | null | undefined;
          if (status === 'COMPLETED') {
            nextDisbursedAt = existing.disbursedAt ?? new Date();
          } else if (status === 'REVERSED') {
            nextDisbursedAt = null;
          }

          // Append-only audit trail. null → treated as []. Read + write happen
          // inside the same transaction, so concurrent transitions serialize.
          const priorHistory = Array.isArray(existing.statusHistory)
            ? (existing.statusHistory as unknown[])
            : [];
          const nextHistory: Prisma.InputJsonValue = [
            ...priorHistory,
            {
              from,
              to: status,
              at: new Date().toISOString(),
              by: opts.by ?? null,
            },
          ] as Prisma.InputJsonValue;

          return tx.disbursement.update({
            where: { id },
            data: {
              status,
              ...(nextDisbursedAt !== undefined ? { disbursedAt: nextDisbursedAt } : {}),
              statusHistory: nextHistory,
            },
            include: { lines: true },
          });
        }),
    });
  }
}
