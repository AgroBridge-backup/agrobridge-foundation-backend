import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { Errors } from '../errors/app-error.js';
import { CampaignRepository } from '../repositories/campaign-repo.js';

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().trim().min(1).max(10000),
  goalAmount: z.number().int().positive(),
  currency: z.string().trim().length(3).toLowerCase().default('usd'),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).default('DRAFT'),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  imageUrl: z.string().url().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().trim().min(1).max(10000).optional(),
  goalAmount: z.number().int().positive().optional(),
  currency: z.string().trim().length(3).toLowerCase().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listCampaignsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
  sort: z.string().default('createdAt:desc'),
  includeDeleted: z.coerce.boolean().default(false),
});

// =============================================================================
// SERVICE TYPES
// =============================================================================

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export class CampaignService {
  constructor(private readonly campaigns: CampaignRepository) {}

  /**
   * Create a new campaign
   */
  async create(input: unknown) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('campaign.create', async (span) => {
      try {
        const parsed = createCampaignSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        span.setAttribute('campaign.slug', parsed.data.slug);
        span.setAttribute('campaign.goal_amount', parsed.data.goalAmount);

        // Validate date range
        if (parsed.data.startDate && parsed.data.endDate) {
          if (parsed.data.endDate <= parsed.data.startDate) {
            throw Errors.validation({ message: 'End date must be after start date' });
          }
        }

        // Check slug uniqueness
        const existing = await this.campaigns.findBySlug(parsed.data.slug);
        if (existing) {
          throw Errors.conflict('A campaign with this slug already exists');
        }

        const createInput: Parameters<typeof this.campaigns.create>[0] = {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description,
          goalAmount: parsed.data.goalAmount,
          currency: parsed.data.currency,
          status: parsed.data.status as any,
        };
        if (parsed.data.startDate) createInput.startDate = parsed.data.startDate;
        if (parsed.data.endDate) createInput.endDate = parsed.data.endDate;
        if (parsed.data.imageUrl) createInput.imageUrl = parsed.data.imageUrl;
        if (parsed.data.metadata) createInput.metadata = parsed.data.metadata as any;

        const campaign = await this.campaigns.create(createInput);

        span.setAttribute('campaign.id', campaign.id);
        span.end();

        return campaign;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Update an existing campaign
   */
  async update(campaignId: string, input: unknown) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('campaign.update', async (span) => {
      try {
        const parsed = updateCampaignSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        span.setAttribute('campaign.id', campaignId);

        // Check campaign exists
        const existing = await this.campaigns.findById(campaignId);
        if (!existing || existing.deletedAt) {
          throw Errors.notFound('Campaign not found');
        }

        // Check slug uniqueness if changing
        if (parsed.data.slug && parsed.data.slug !== existing.slug) {
          const slugExists = await this.campaigns.findBySlug(parsed.data.slug);
          if (slugExists) {
            throw Errors.conflict('A campaign with this slug already exists');
          }
        }

        const updateData: Parameters<typeof this.campaigns.update>[1] = {};
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
        if (parsed.data.slug !== undefined) updateData.slug = parsed.data.slug;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
        if (parsed.data.goalAmount !== undefined) updateData.goalAmount = parsed.data.goalAmount;
        if (parsed.data.currency !== undefined) updateData.currency = parsed.data.currency;
        if (parsed.data.status !== undefined) updateData.status = parsed.data.status as any;
        if (parsed.data.startDate !== undefined) updateData.startDate = parsed.data.startDate;
        if (parsed.data.endDate !== undefined) updateData.endDate = parsed.data.endDate;
        if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
        if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata as any;

        const campaign = await this.campaigns.update(campaignId, updateData);

        span.end();
        return campaign;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Get campaign by ID
   */
  async getById(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign || campaign.deletedAt) {
      return null;
    }
    return campaign;
  }

  /**
   * Get campaign by slug (public)
   */
  async getBySlug(slug: string) {
    const campaign = await this.campaigns.findBySlug(slug);
    if (!campaign || campaign.deletedAt) {
      return null;
    }
    return campaign;
  }

  /**
   * Get campaign progress metrics
   */
  async getProgress(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign || campaign.deletedAt) {
      throw Errors.notFound('Campaign not found');
    }

    return this.campaigns.getCampaignProgress(campaignId);
  }

  /**
   * List campaigns with pagination (admin)
   */
  async list(input: unknown) {
    const parsed = listCampaignsSchema.safeParse(input);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());

    const { page, pageSize, status, sort, includeDeleted } = parsed.data;

    // Parse sort parameter
    const [field, direction] = sort.split(':') as [
      'createdAt' | 'startDate' | 'goalAmount',
      'asc' | 'desc',
    ];

    const filters: { status?: CampaignStatus; includeDeleted?: boolean } = { includeDeleted };
    if (status) filters.status = status as CampaignStatus;

    const [items, total] = await this.campaigns.listPaged({
      page,
      pageSize,
      filters,
      sort: { field: field || 'createdAt', direction: direction || 'desc' },
    });

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  /**
   * List active campaigns (public)
   */
  async listActive() {
    const campaigns = await this.campaigns.listActive();

    // Get progress for each campaign
    const withProgress = await Promise.all(
      campaigns.map(async (campaign) => {
        const progress = await this.campaigns.getCampaignProgress(campaign.id);
        return {
          ...campaign,
          progress,
        };
      }),
    );

    return withProgress;
  }

  /**
   * Soft delete a campaign
   */
  async delete(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign) {
      throw Errors.notFound('Campaign not found');
    }
    if (campaign.deletedAt) {
      throw Errors.conflict('Campaign already deleted');
    }

    await this.campaigns.softDelete(campaignId);
  }

  /**
   * Restore a soft-deleted campaign
   */
  async restore(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign) {
      throw Errors.notFound('Campaign not found');
    }
    if (!campaign.deletedAt) {
      throw Errors.conflict('Campaign is not deleted');
    }

    return this.campaigns.restore(campaignId);
  }
}
