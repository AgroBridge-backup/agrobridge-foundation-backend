import bcrypt from 'bcryptjs';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { PrismaClient, AdminRole } from '@prisma/client';

import { Errors } from '../errors/app-error.js';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createAdminSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200), // Require strong passwords
  role: z.enum(['ADMIN', 'SUPER_ADMIN']).default('ADMIN'),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});

const updateAdminSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']).optional(),
  firstName: z.string().trim().min(1).max(100).optional().nullable(),
  lastName: z.string().trim().min(1).max(100).optional().nullable(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(200)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

const listAdminsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

// =============================================================================
// SERVICE TYPES
// =============================================================================

export type CreateAdminInput = z.infer<typeof createAdminSchema>;
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ListAdminsInput = z.infer<typeof listAdminsSchema>;

export interface AdminUserSummary {
  id: string;
  email: string;
  role: AdminRole;
  firstName: string | null;
  lastName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export class AdminUserService {
  private readonly BCRYPT_ROUNDS = 12;

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a new admin user (SUPER_ADMIN only)
   */
  async createAdmin(input: unknown, createdBy: string): Promise<AdminUserSummary> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.create', async (span) => {
      try {
        const parsed = createAdminSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        const { email, password, role, firstName, lastName } = parsed.data;
        const normalizedEmail = email.toLowerCase().trim();

        span.setAttribute('admin_user.email', normalizedEmail);
        span.setAttribute('admin_user.role', role);

        // Check if email already exists (including soft-deleted)
        const existing = await this.prisma.adminUser.findFirst({
          where: { email: normalizedEmail },
        });

        if (existing) {
          if (existing.deletedAt) {
            throw Errors.conflict('An account with this email was previously deleted. Contact support to restore it.');
          }
          throw Errors.conflict('An admin with this email already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, this.BCRYPT_ROUNDS);

        const admin = await this.prisma.adminUser.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role,
            firstName: firstName ?? null,
            lastName: lastName ?? null,
            createdBy,
          },
          select: {
            id: true,
            email: true,
            role: true,
            firstName: true,
            lastName: true,
            lastLoginAt: true,
            createdAt: true,
            deletedAt: true,
          },
        });

        span.setAttribute('admin_user.id', admin.id);
        span.end();

        return admin;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Update an existing admin user
   */
  async updateAdmin(adminId: string, input: unknown, requesterId: string): Promise<AdminUserSummary> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.update', async (span) => {
      try {
        const parsed = updateAdminSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        span.setAttribute('admin_user.id', adminId);

        // Fetch existing admin
        const existing = await this.prisma.adminUser.findUnique({
          where: { id: adminId },
        });

        if (!existing || existing.deletedAt) {
          throw Errors.notFound('Admin user not found');
        }

        // Prevent self-demotion (admins can't change their own role)
        if (parsed.data.role && adminId === requesterId) {
          throw Errors.forbidden();
        }

        // Check email uniqueness if changing
        if (parsed.data.email) {
          const normalizedEmail = parsed.data.email.toLowerCase().trim();
          const emailExists = await this.prisma.adminUser.findFirst({
            where: {
              email: normalizedEmail,
              id: { not: adminId },
              deletedAt: null,
            },
          });

          if (emailExists) {
            throw Errors.conflict('An admin with this email already exists');
          }
        }

        const admin = await this.prisma.adminUser.update({
          where: { id: adminId },
          data: {
            ...(parsed.data.email && { email: parsed.data.email.toLowerCase().trim() }),
            ...(parsed.data.role && { role: parsed.data.role }),
            ...(parsed.data.firstName !== undefined && { firstName: parsed.data.firstName }),
            ...(parsed.data.lastName !== undefined && { lastName: parsed.data.lastName }),
          },
          select: {
            id: true,
            email: true,
            role: true,
            firstName: true,
            lastName: true,
            lastLoginAt: true,
            createdAt: true,
            deletedAt: true,
          },
        });

        span.end();
        return admin;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Change password for an admin (self-service)
   */
  async changePassword(adminId: string, input: unknown): Promise<void> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.change_password', async (span) => {
      try {
        const parsed = changePasswordSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        span.setAttribute('admin_user.id', adminId);

        const admin = await this.prisma.adminUser.findUnique({
          where: { id: adminId },
          select: { passwordHash: true, deletedAt: true },
        });

        if (!admin || admin.deletedAt) {
          throw Errors.notFound('Admin user not found');
        }

        // Verify current password
        const isValid = await bcrypt.compare(parsed.data.currentPassword, admin.passwordHash);
        if (!isValid) {
          throw Errors.unauthorized();
        }

        // Ensure new password is different
        const isSame = await bcrypt.compare(parsed.data.newPassword, admin.passwordHash);
        if (isSame) {
          throw Errors.validation({ message: 'New password must be different from current password' });
        }

        // Hash and save new password
        const passwordHash = await bcrypt.hash(parsed.data.newPassword, this.BCRYPT_ROUNDS);
        await this.prisma.adminUser.update({
          where: { id: adminId },
          data: { passwordHash },
        });

        span.end();
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Reset password for another admin (SUPER_ADMIN only)
   */
  async resetPassword(adminId: string, newPassword: string): Promise<void> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.reset_password', async (span) => {
      try {
        // Validate new password strength
        const passwordSchema = z
          .string()
          .min(12)
          .regex(/[A-Z]/)
          .regex(/[a-z]/)
          .regex(/[0-9]/);

        const result = passwordSchema.safeParse(newPassword);
        if (!result.success) {
          throw Errors.validation({ message: 'Password does not meet requirements' });
        }

        span.setAttribute('admin_user.id', adminId);

        const admin = await this.prisma.adminUser.findUnique({
          where: { id: adminId },
          select: { deletedAt: true },
        });

        if (!admin || admin.deletedAt) {
          throw Errors.notFound('Admin user not found');
        }

        const passwordHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);
        await this.prisma.adminUser.update({
          where: { id: adminId },
          data: {
            passwordHash,
            failedAttempts: 0,
            lockedUntil: null,
          },
        });

        span.end();
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Soft delete an admin user
   */
  async deleteAdmin(adminId: string, requesterId: string): Promise<void> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.delete', async (span) => {
      try {
        span.setAttribute('admin_user.id', adminId);

        // Prevent self-deletion
        if (adminId === requesterId) {
          throw Errors.forbidden();
        }

        const admin = await this.prisma.adminUser.findUnique({
          where: { id: adminId },
          select: { deletedAt: true },
        });

        if (!admin) {
          throw Errors.notFound('Admin user not found');
        }

        if (admin.deletedAt) {
          throw Errors.conflict('Admin user already deleted');
        }

        // Soft delete
        await this.prisma.adminUser.update({
          where: { id: adminId },
          data: { deletedAt: new Date() },
        });

        span.end();
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Restore a soft-deleted admin user
   */
  async restoreAdmin(adminId: string): Promise<AdminUserSummary> {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('admin_user.restore', async (span) => {
      try {
        span.setAttribute('admin_user.id', adminId);

        const admin = await this.prisma.adminUser.findUnique({
          where: { id: adminId },
        });

        if (!admin) {
          throw Errors.notFound('Admin user not found');
        }

        if (!admin.deletedAt) {
          throw Errors.conflict('Admin user is not deleted');
        }

        const restored = await this.prisma.adminUser.update({
          where: { id: adminId },
          data: { deletedAt: null },
          select: {
            id: true,
            email: true,
            role: true,
            firstName: true,
            lastName: true,
            lastLoginAt: true,
            createdAt: true,
            deletedAt: true,
          },
        });

        span.end();
        return restored;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Get a single admin by ID
   */
  async getAdmin(adminId: string): Promise<AdminUserSummary | null> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    if (!admin || admin.deletedAt) {
      return null;
    }

    return admin;
  }

  /**
   * List admin users with pagination
   */
  async listAdmins(input: unknown): Promise<{
    items: AdminUserSummary[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const parsed = listAdminsSchema.safeParse(input);
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());

    const { page, pageSize, role, includeDeleted } = parsed.data;
    const skip = (page - 1) * pageSize;

    const where = {
      ...(role && { role }),
      ...(!includeDeleted && { deletedAt: null }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminUser.findMany({
        where,
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          lastLoginAt: true,
          createdAt: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.adminUser.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
