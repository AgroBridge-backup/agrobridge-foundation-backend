import bcrypt from 'bcryptjs';

import { Errors } from '../errors/app-error.js';
import { AdminUserRepository } from '../repositories/admin-user-repo.js';

export class AuthService {
  constructor(private readonly adminUsers: AdminUserRepository) {}

  async login(input: { email: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const user = await this.adminUsers.findByEmail(email);
    if (!user) throw Errors.unauthorized();

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw Errors.unauthorized();

    await this.adminUsers.updateLastLogin(user.id, new Date());

    return {
      adminUserId: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
