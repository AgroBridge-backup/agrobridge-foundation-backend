import type { PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export class AdminUserRepository {
  constructor(private readonly prisma: PrismaClient) { }

  findByEmail(email: string) {
    return withDbSpan({
      name: 'db.admin_user.find_by_email',
      model: 'AdminUser',
      operation: 'findUnique',
      fn: async () => this.prisma.adminUser.findUnique({ where: { email } }),
    });
  }

  findById(id: string) {
    return withDbSpan({
      name: 'db.admin_user.find_by_id',
      model: 'AdminUser',
      operation: 'findUnique',
      fn: async () => this.prisma.adminUser.findUnique({ where: { id } }),
    });
  }

  updateLastLogin(id: string, at: Date) {
    return withDbSpan({
      name: 'db.admin_user.update_last_login',
      model: 'AdminUser',
      operation: 'update',
      fn: async () => this.prisma.adminUser.update({ where: { id }, data: { lastLoginAt: at } }),
    });
  }

  incrementFailedAttempts(id: string) {
    return withDbSpan({
      name: 'db.admin_user.increment_failed_attempts',
      model: 'AdminUser',
      operation: 'update',
      fn: async () =>
        this.prisma.adminUser.update({
          where: { id },
          data: { failedAttempts: { increment: 1 } },
          select: { id: true, failedAttempts: true, lockedUntil: true },
        }),
    });
  }

  lockAccount(id: string, lockedUntil: Date) {
    return withDbSpan({
      name: 'db.admin_user.lock_account',
      model: 'AdminUser',
      operation: 'update',
      fn: async () =>
        this.prisma.adminUser.update({
          where: { id },
          data: { lockedUntil },
          select: { id: true, failedAttempts: true, lockedUntil: true },
        }),
    });
  }

  resetFailedAttempts(id: string) {
    return withDbSpan({
      name: 'db.admin_user.reset_failed_attempts',
      model: 'AdminUser',
      operation: 'update',
      fn: async () =>
        this.prisma.adminUser.update({
          where: { id },
          data: { failedAttempts: 0, lockedUntil: null },
          select: { id: true, failedAttempts: true, lockedUntil: true },
        }),
    });
  }
}
