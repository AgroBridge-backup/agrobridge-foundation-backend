import { Prisma, PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

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

  create(input: {
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
  }) {
    return withDbSpan({
      name: 'db.disbursement.create',
      model: 'Disbursement',
      operation: 'create',
      fn: async () =>
        this.prisma.disbursement.create({
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
        }),
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
   * Donor traceability: find the COMPLETED disbursement (if any) linked to a
   * donation. Selects only donor-safe fields — never recipientIdentifier.
   * Uses findFirst over lines.some(donationId) + status COMPLETED.
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
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED',
    disbursedAt?: Date,
  ) {
    return withDbSpan({
      name: 'db.disbursement.update_status',
      model: 'Disbursement',
      operation: 'update',
      fn: async () =>
        this.prisma.disbursement.update({
          where: { id },
          data: {
            status,
            ...(disbursedAt ? { disbursedAt } : {}),
          },
          include: { lines: true },
        }),
    });
  }
}
