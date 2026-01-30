import type { PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export class AdminUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByEmail(email: string) {
    return withDbSpan({
      name: 'db.admin_user.find_by_email',
      model: 'AdminUser',
      operation: 'findUnique',
      fn: async () => this.prisma.adminUser.findUnique({ where: { email } }),
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
}
