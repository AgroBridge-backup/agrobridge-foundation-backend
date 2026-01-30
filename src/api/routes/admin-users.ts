import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireSuperAdmin } from '../../auth/jwt.js';
import { ok, fail } from '../../http/response.js';
import { AdminUserService } from '../../services/admin-user-service.js';

/**
 * Admin User Management Routes
 *
 * All routes require authentication.
 * CRUD operations require SUPER_ADMIN role.
 * Password change is available to all authenticated admins for their own account.
 */
export async function adminUserRoutes(app: FastifyInstance) {
  // =========================================================================
  // LIST ADMINS (SUPER_ADMIN only)
  // =========================================================================
  app.get('/admin/users', async (req) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const service = new AdminUserService(app.prisma);
    const result = await service.listAdmins(req.query);

    return ok(result);
  });

  // =========================================================================
  // GET SINGLE ADMIN (SUPER_ADMIN only)
  // =========================================================================
  app.get('/admin/users/:id', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid user ID format' });
    }

    const service = new AdminUserService(app.prisma);
    const admin = await service.getAdmin(id);

    if (!admin) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Admin user not found' });
    }

    return ok(admin);
  });

  // =========================================================================
  // CREATE ADMIN (SUPER_ADMIN only)
  // =========================================================================
  app.post('/admin/users', async (req, reply) => {
    const payload = await requireAdmin(req);
    requireSuperAdmin(req);

    const service = new AdminUserService(app.prisma);
    const admin = await service.createAdmin(req.body, payload.sub);

    reply.status(201);
    return ok(admin);
  });

  // =========================================================================
  // UPDATE ADMIN (SUPER_ADMIN only)
  // =========================================================================
  app.patch('/admin/users/:id', async (req, reply) => {
    const payload = await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid user ID format' });
    }

    const service = new AdminUserService(app.prisma);
    const admin = await service.updateAdmin(id, req.body, payload.sub);

    return ok(admin);
  });

  // =========================================================================
  // DELETE ADMIN (SUPER_ADMIN only) - Soft delete
  // =========================================================================
  app.delete('/admin/users/:id', async (req, reply) => {
    const payload = await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid user ID format' });
    }

    const service = new AdminUserService(app.prisma);
    await service.deleteAdmin(id, payload.sub);

    reply.status(204);
    return;
  });

  // =========================================================================
  // RESTORE ADMIN (SUPER_ADMIN only) - Restore soft-deleted user
  // =========================================================================
  app.post('/admin/users/:id/restore', async (req) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };

    const service = new AdminUserService(app.prisma);
    const admin = await service.restoreAdmin(id);

    return ok(admin);
  });

  // =========================================================================
  // RESET PASSWORD (SUPER_ADMIN only) - Force reset another user's password
  // =========================================================================
  app.post('/admin/users/:id/reset-password', async (req, reply) => {
    await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };
    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword || typeof newPassword !== 'string') {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'newPassword is required' });
    }

    const service = new AdminUserService(app.prisma);
    await service.resetPassword(id, newPassword);

    return ok({ message: 'Password reset successfully' });
  });

  // =========================================================================
  // CHANGE OWN PASSWORD (All authenticated admins)
  // =========================================================================
  app.post('/admin/me/password', async (req) => {
    const payload = await requireAdmin(req);

    const service = new AdminUserService(app.prisma);
    await service.changePassword(payload.sub, req.body);

    return ok({ message: 'Password changed successfully' });
  });

  // =========================================================================
  // GET OWN PROFILE (All authenticated admins)
  // =========================================================================
  app.get('/admin/me', async (req, reply) => {
    const payload = await requireAdmin(req);

    const service = new AdminUserService(app.prisma);
    const admin = await service.getAdmin(payload.sub);

    if (!admin) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Admin user not found' });
    }

    return ok(admin);
  });

  // =========================================================================
  // UPDATE OWN PROFILE (All authenticated admins - limited fields)
  // =========================================================================
  app.patch('/admin/me', async (req) => {
    const payload = await requireAdmin(req);

    // Only allow updating name fields for self
    const { firstName, lastName } = req.body as { firstName?: string; lastName?: string };

    const service = new AdminUserService(app.prisma);
    const admin = await service.updateAdmin(
      payload.sub,
      { firstName, lastName },
      payload.sub,
    );

    return ok(admin);
  });
}
