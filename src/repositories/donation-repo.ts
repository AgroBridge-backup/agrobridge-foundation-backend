import type { DonationStatus } from '@prisma/client';
import { Prisma, PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export type DonationListFilters = {
  status?: DonationStatus;
  campaignId?: string;
  includeDeleted?: boolean;
};

export type DonationListSort = {
  field: 'createdAt';
  direction: 'asc' | 'desc';
};

export class DonationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createPending(input: {
    amount: number;
    currency: string;
    donorEmail?: string;
    donorName?: string;
    isAnonymous?: boolean;
    message?: string;
    campaignId?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return withDbSpan({
      name: 'db.donation.create_pending',
      model: 'Donation',
      operation: 'create',
      fn: async () =>
        this.prisma.donation.create({
          data: {
            amount: input.amount,
            currency: input.currency,
            status: 'PENDING',
            type: 'ONE_TIME',
            donorEmail: input.donorEmail ?? null,
            donorName: input.donorName ?? null,
            isAnonymous: input.isAnonymous ?? false,
            message: input.message ?? null,
            campaignId: input.campaignId ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
          },
        }),
    });
  }

  attachStripeSession(donationId: string, stripeSessionId: string) {
    return withDbSpan({
      name: 'db.donation.attach_stripe_session',
      model: 'Donation',
      operation: 'update',
      fn: async () =>
        this.prisma.donation.update({
          where: { id: donationId },
          data: { stripeSessionId },
        }),
    });
  }

  updateStatusByStripeSessionId(stripeSessionId: string, status: DonationStatus) {
    return withDbSpan({
      name: 'db.donation.update_status_by_session',
      model: 'Donation',
      operation: 'updateMany',
      fn: async () =>
        this.prisma.donation.updateMany({
          where: { stripeSessionId },
          data: { status },
        }),
    });
  }

  listPaged(input: {
    page: number;
    pageSize: number;
    filters: DonationListFilters;
    sort: DonationListSort;
  }) {
    return withDbSpan({
      name: 'db.donation.list_paged',
      model: 'Donation',
      operation: 'findMany+count',
      fn: async () => {
        const skip = (input.page - 1) * input.pageSize;
        const where: Prisma.DonationWhereInput = {
          ...(input.filters.status ? { status: input.filters.status } : {}),
          ...(input.filters.campaignId ? { campaignId: input.filters.campaignId } : {}),
          ...(!input.filters.includeDeleted ? { deletedAt: null } : {}),
        };

        const orderBy = { [input.sort.field]: input.sort.direction } as const;

        return this.prisma.$transaction([
          this.prisma.donation.findMany({
            where,
            orderBy,
            skip,
            take: input.pageSize,
            include: {
              campaign: {
                select: { id: true, name: true, slug: true },
              },
            },
          }),
          this.prisma.donation.count({ where }),
        ]);
      },
    });
  }

  // Cursor pagination is preferred at scale.
  // Uses a (createdAt, id) cursor without requiring schema changes.
  async listCursor(input: {
    pageSize: number;
    cursor?: { createdAt: Date; id: string };
    filters: DonationListFilters;
    direction: 'asc' | 'desc';
  }): Promise<{
    items: Awaited<ReturnType<PrismaClient['donation']['findMany']>>;
    nextCursor: { createdAt: Date; id: string } | null;
  }> {
    return withDbSpan({
      name: 'db.donation.list_cursor',
      model: 'Donation',
      operation: 'findMany',
      fn: async () => {
        const where: any = {
          ...(input.filters.status ? { status: input.filters.status } : {}),
          ...(input.filters.campaignId ? { campaignId: input.filters.campaignId } : {}),
          ...(!input.filters.includeDeleted ? { deletedAt: null } : {}),
        };

        // Keyset pagination filter
        if (input.cursor) {
          if (input.direction === 'desc') {
            where.OR = [
              { createdAt: { lt: input.cursor.createdAt } },
              { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
            ];
          } else {
            where.OR = [
              { createdAt: { gt: input.cursor.createdAt } },
              { createdAt: input.cursor.createdAt, id: { gt: input.cursor.id } },
            ];
          }
        }

        const orderBy = [{ createdAt: input.direction }, { id: input.direction }];

        const items = await this.prisma.donation.findMany({
          where,
          orderBy,
          take: input.pageSize,
        });

        const last = items.length ? items[items.length - 1] : null;
        const nextCursor = last ? { createdAt: last.createdAt, id: last.id } : null;

        return { items, nextCursor };
      },
    });
  }

  dashboardMetrics() {
    return withDbSpan({
      name: 'db.donation.dashboard_metrics',
      model: 'Donation',
      operation: 'aggregate+count+countDistinct',
      fn: async () => {
        const [succeededAgg, donationCount, lastDonation] = await this.prisma.$transaction([
          this.prisma.donation.aggregate({
            _sum: { amount: true },
            _count: { _all: true },
            where: { status: 'SUCCEEDED', deletedAt: null },
          }),
          this.prisma.donation.count({ where: { deletedAt: null } }),
          this.prisma.donation.findFirst({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);

        // Use COUNT(DISTINCT donorEmail) at the DB level.
        // Prisma doesn't expose this directly for all providers, so we use a safe raw query.
        const donorCountRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT "donorEmail")::bigint AS count
          FROM "Donation"
          WHERE "donorEmail" IS NOT NULL AND "deletedAt" IS NULL
        `;

        const donorCount = Number(donorCountRows[0]?.count ?? 0n);

        return { succeededAgg, donationCount, lastDonation, donorCount };
      },
    });
  }

  /**
   * Soft delete a donation
   */
  softDelete(id: string) {
    return withDbSpan({
      name: 'db.donation.soft_delete',
      model: 'Donation',
      operation: 'update',
      fn: async () =>
        this.prisma.donation.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
    });
  }

  /**
   * Restore a soft-deleted donation
   */
  restore(id: string) {
    return withDbSpan({
      name: 'db.donation.restore',
      model: 'Donation',
      operation: 'update',
      fn: async () =>
        this.prisma.donation.update({
          where: { id },
          data: { deletedAt: null },
        }),
    });
  }
}
