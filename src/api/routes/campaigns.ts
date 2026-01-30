import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireSuperAdmin } from '../../auth/jwt.js';
import { ok, fail } from '../../http/response.js';
import { CampaignRepository } from '../../repositories/campaign-repo.js';
import { CampaignService } from '../../services/campaign-service.js';

/**
 * Campaign Routes
 *
 * Public routes:
 * - GET /campaigns - List active campaigns
 * - GET /campaigns/:slug - Get campaign by slug
 * - GET /campaigns/:slug/progress - Get campaign progress
 *
 * Admin routes (SUPER_ADMIN):
 * - GET /admin/campaigns - List all campaigns with pagination
 * - POST /admin/campaigns - Create campaign
 * - PATCH /admin/campaigns/:id - Update campaign
 * - DELETE /admin/campaigns/:id - Soft delete campaign
 * - POST /admin/campaigns/:id/restore - Restore campaign
 */
export async function campaignRoutes(app: FastifyInstance) {
  // =========================================================================
  // PUBLIC ROUTES
  // =========================================================================

  /**
   * List active campaigns (for public donation page)
   */
  app.get('/campaigns', async () => {
    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaigns = await service.listActive();
    return ok(campaigns);
  });

  /**
   * Get campaign by slug (public)
   */
  app.get('/campaigns/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };

    // Validate slug format
    const slugSchema = z.string().regex(/^[a-z0-9-]+$/);
    const parseResult = slugSchema.safeParse(slug);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid campaign slug format' });
    }

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.getBySlug(slug);

    if (!campaign) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Campaign not found' });
    }

    // Get progress for public display
    const progress = await service.getProgress(campaign.id);

    return ok({ ...campaign, progress });
  });

  /**
   * Get campaign progress (public)
   */
  app.get('/campaigns/:slug/progress', async (req, reply) => {
    const { slug } = req.params as { slug: string };

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.getBySlug(slug);

    if (!campaign) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Campaign not found' });
    }

    const progress = await service.getProgress(campaign.id);
    return ok(progress);
  });

  // =========================================================================
  // ADMIN ROUTES
  // =========================================================================

  /**
   * List all campaigns (admin)
   */
  app.get('/admin/campaigns', async (req) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const result = await service.list(req.query);

    return ok(result);
  });

  /**
   * Get campaign by ID (admin)
   */
  app.get('/admin/campaigns/:id', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid campaign ID format' });
    }

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.getById(id);

    if (!campaign) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Campaign not found' });
    }

    const progress = await service.getProgress(id);
    return ok({ ...campaign, progress });
  });

  /**
   * Create campaign (admin)
   */
  app.post('/admin/campaigns', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.create(req.body);

    reply.status(201);
    return ok(campaign);
  });

  /**
   * Update campaign (admin)
   */
  app.patch('/admin/campaigns/:id', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid campaign ID format' });
    }

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.update(id, req.body);

    return ok(campaign);
  });

  /**
   * Delete campaign (admin) - soft delete
   */
  app.delete('/admin/campaigns/:id', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid campaign ID format' });
    }

    const service = new CampaignService(new CampaignRepository(app.prisma));
    await service.delete(id);

    reply.status(204);
    return;
  });

  /**
   * Restore campaign (admin)
   */
  app.post('/admin/campaigns/:id/restore', async (req) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    const service = new CampaignService(new CampaignRepository(app.prisma));
    const campaign = await service.restore(id);

    return ok(campaign);
  });
}
