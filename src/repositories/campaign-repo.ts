import { Prisma, PrismaClient } from '@prisma/client';
import type { CampaignStatus } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export type CampaignListFilters = {
  status?: CampaignStatus;
  includeDeleted?: boolean;
};

export type CampaignListSort = {
  field: 'createdAt' | 'startDate' | 'goalAmount';
  direction: 'asc' | 'desc';
};

export class CampaignRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: {
    name: string;
    slug: string;
    description: string;
    goalAmount: number;
    currency?: string;
    status?: CampaignStatus;
    startDate?: Date;
    endDate?: Date;
    imageUrl?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return withDbSpan({
      name: 'db.campaign.create',
      model: 'Campaign',
      operation: 'create',
      fn: async () =>
        this.prisma.campaign.create({
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            goalAmount: input.goalAmount,
            currency: input.currency ?? 'usd',
            status: input.status ?? 'DRAFT',
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            imageUrl: input.imageUrl ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
          },
        }),
    });
  }

  findById(id: string) {
    return withDbSpan({
      name: 'db.campaign.find_by_id',
      model: 'Campaign',
      operation: 'findUnique',
      fn: async () =>
        this.prisma.campaign.findUnique({
          where: { id },
          include: {
            _count: {
              select: { donations: { where: { status: 'SUCCEEDED', deletedAt: null } } },
            },
          },
        }),
    });
  }

  findBySlug(slug: string) {
    return withDbSpan({
      name: 'db.campaign.find_by_slug',
      model: 'Campaign',
      operation: 'findUnique',
      fn: async () =>
        this.prisma.campaign.findUnique({
          where: { slug, deletedAt: null },
          include: {
            _count: {
              select: { donations: { where: { status: 'SUCCEEDED', deletedAt: null } } },
            },
          },
        }),
    });
  }

  update(
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string;
      goalAmount?: number;
      currency?: string;
      status?: CampaignStatus;
      startDate?: Date | null;
      endDate?: Date | null;
      imageUrl?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return withDbSpan({
      name: 'db.campaign.update',
      model: 'Campaign',
      operation: 'update',
      fn: async () =>
        this.prisma.campaign.update({
          where: { id },
          data: input,
        }),
    });
  }

  softDelete(id: string) {
    return withDbSpan({
      name: 'db.campaign.soft_delete',
      model: 'Campaign',
      operation: 'update',
      fn: async () =>
        this.prisma.campaign.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
    });
  }

  restore(id: string) {
    return withDbSpan({
      name: 'db.campaign.restore',
      model: 'Campaign',
      operation: 'update',
      fn: async () =>
        this.prisma.campaign.update({
          where: { id },
          data: { deletedAt: null },
        }),
    });
  }

  listPaged(input: {
    page: number;
    pageSize: number;
    filters: CampaignListFilters;
    sort: CampaignListSort;
  }) {
    return withDbSpan({
      name: 'db.campaign.list_paged',
      model: 'Campaign',
      operation: 'findMany+count',
      fn: async () => {
        const skip = (input.page - 1) * input.pageSize;
        const where: Prisma.CampaignWhereInput = {
          ...(input.filters.status ? { status: input.filters.status } : {}),
          ...(!input.filters.includeDeleted ? { deletedAt: null } : {}),
        };

        const orderBy = { [input.sort.field]: input.sort.direction } as const;

        return this.prisma.$transaction([
          this.prisma.campaign.findMany({
            where,
            orderBy,
            skip,
            take: input.pageSize,
            include: {
              _count: {
                select: { donations: { where: { status: 'SUCCEEDED', deletedAt: null } } },
              },
            },
          }),
          this.prisma.campaign.count({ where }),
        ]);
      },
    });
  }

  /**
   * Get campaign progress (total raised, donor count)
   */
  getCampaignProgress(campaignId: string) {
    return withDbSpan({
      name: 'db.campaign.get_progress',
      model: 'Campaign',
      operation: 'aggregate',
      fn: async () => {
        const [campaign, stats, donorCount] = await this.prisma.$transaction([
          this.prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { goalAmount: true, currency: true },
          }),
          this.prisma.donation.aggregate({
            where: {
              campaignId,
              status: 'SUCCEEDED',
              deletedAt: null,
            },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          this.prisma.donation.groupBy({
            by: ['donorEmail'],
            orderBy: { donorEmail: 'asc' },
            where: {
              campaignId,
              status: 'SUCCEEDED',
              deletedAt: null,
              donorEmail: { not: null },
            },
          }),
        ]);

        return {
          goalAmount: campaign?.goalAmount ?? 0,
          currency: campaign?.currency ?? 'usd',
          totalRaised: stats._sum.amount ?? 0,
          donationCount: stats._count._all,
          uniqueDonors: donorCount.length,
          percentComplete: campaign?.goalAmount
            ? Math.min(100, ((stats._sum.amount ?? 0) / campaign.goalAmount) * 100)
            : 0,
        };
      },
    });
  }

  /**
   * Get public active campaigns for frontend
   */
  listActive() {
    return withDbSpan({
      name: 'db.campaign.list_active',
      model: 'Campaign',
      operation: 'findMany',
      fn: async () => {
        const now = new Date();
        return this.prisma.campaign.findMany({
          where: {
            status: 'ACTIVE',
            deletedAt: null,
            OR: [
              { startDate: null },
              { startDate: { lte: now } },
            ],
            AND: [
              {
                OR: [
                  { endDate: null },
                  { endDate: { gte: now } },
                ],
              },
            ],
          },
          orderBy: { startDate: 'desc' },
          include: {
            _count: {
              select: { donations: { where: { status: 'SUCCEEDED', deletedAt: null } } },
            },
          },
        });
      },
    });
  }
}
