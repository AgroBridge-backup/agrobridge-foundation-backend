/**
 * Admin User Factory
 * Factory for creating test admin users with various roles and configurations
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { hashPassword } from '../../src/lib/auth.js';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

export interface AdminUserConfig {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  status?: UserStatus;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: string[];
  metadata: Record<string, unknown>;
}

/**
 * Default admin user configuration
 */
const DEFAULT_CONFIG: Required<AdminUserConfig> = {
  email: `admin-${faker.string.uuid()}@agrobridge.test`,
  password: 'SecureAdmin123!',
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  role: UserRole.ADMIN,
  status: UserStatus.ACTIVE,
  emailVerified: true,
  twoFactorEnabled: false,
  permissions: ['*'],
  metadata: {}
};

/**
 * Admin User Factory class
 */
export class AdminUserFactory {
  private prisma: PrismaClient;
  private createdUsers: string[] = [];

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Create a single admin user
   */
  async create(config: AdminUserConfig = {}): Promise<AdminUser> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const hashedPassword = await hashPassword(mergedConfig.password);

    const user = await this.prisma.user.create({
      data: {
        email: mergedConfig.email,
        passwordHash: hashedPassword,
        firstName: mergedConfig.firstName,
        lastName: mergedConfig.lastName,
        role: mergedConfig.role,
        status: mergedConfig.status,
        emailVerified: mergedConfig.emailVerified,
        twoFactorEnabled: mergedConfig.twoFactorEnabled,
        permissions: mergedConfig.permissions,
        metadata: mergedConfig.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    this.createdUsers.push(user.id);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      permissions: user.permissions as string[],
      metadata: user.metadata as Record<string, unknown>
    };
  }

  /**
   * Create multiple admin users
   */
  async createMany(count: number, config: AdminUserConfig = {}): Promise<AdminUser[]> {
    const users: AdminUser[] = [];
    for (let i = 0; i < count; i++) {
      users.push(await this.create({
        ...config,
        email: config.email || `admin-${i}-${faker.string.uuid()}@agrobridge.test`
      }));
    }
    return users;
  }

  /**
   * Create a super admin
   */
  async createSuperAdmin(config: AdminUserConfig = {}): Promise<AdminUser> {
    return this.create({
      ...config,
      role: UserRole.SUPER_ADMIN,
      permissions: ['*', 'super_admin']
    });
  }

  /**
   * Create an admin with specific permissions
   */
  async createWithPermissions(permissions: string[], config: AdminUserConfig = {}): Promise<AdminUser> {
    return this.create({
      ...config,
      permissions
    });
  }

  /**
   * Create an unverified admin
   */
  async createUnverified(config: AdminUserConfig = {}): Promise<AdminUser> {
    return this.create({
      ...config,
      emailVerified: false,
      status: UserStatus.PENDING_VERIFICATION
    });
  }

  /**
   * Create a suspended admin
   */
  async createSuspended(config: AdminUserConfig = {}): Promise<AdminUser> {
    return this.create({
      ...config,
      status: UserStatus.SUSPENDED
    });
  }

  /**
   * Create an admin with 2FA enabled
   */
  async createWith2FA(config: AdminUserConfig = {}): Promise<AdminUser> {
    return this.create({
      ...config,
      twoFactorEnabled: true,
      metadata: {
        ...config.metadata,
        twoFactorSecret: faker.string.alphanumeric(32)
      }
    });
  }

  /**
   * Create an admin with failed login attempts
   */
  async createWithFailedLogins(attempts: number, config: AdminUserConfig = {}): Promise<AdminUser> {
    const user = await this.create(config);
    
    await this.prisma.securityLog.createMany({
      data: Array.from({ length: attempts }, (_, i) => ({
        userId: user.id,
        event: 'LOGIN_FAILED',
        ipAddress: faker.internet.ip(),
        userAgent: faker.internet.userAgent(),
        details: { reason: 'INVALID_CREDENTIALS' },
        createdAt: new Date(Date.now() - i * 60000)
      }))
    });

    return user;
  }

  /**
   * Create concurrent users for race condition testing
   */
  async createConcurrent(count: number, config: AdminUserConfig = {}): Promise<AdminUser[]> {
    const promises = Array.from({ length: count }, (_, i) =>
      this.create({
        ...config,
        email: `concurrent-${i}-${Date.now()}@agrobridge.test`
      })
    );
    return Promise.all(promises);
  }

  /**
   * Get user by email
   */
  async findByEmail(email: string): Promise<AdminUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { email }
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      permissions: user.permissions as string[],
      metadata: user.metadata as Record<string, unknown>
    };
  }

  /**
   * Delete a user by ID
   */
  async delete(userId: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id: userId }
    });
    this.createdUsers = this.createdUsers.filter(id => id !== userId);
  }

  /**
   * Clean up all created users
   */
  async cleanup(): Promise<void> {
    if (this.createdUsers.length === 0) return;

    await this.prisma.user.deleteMany({
      where: { id: { in: this.createdUsers } }
    });
    this.createdUsers = [];
  }

  /**
   * Generate valid admin credentials
   */
  generateCredentials(config: Partial<AdminUserConfig> = {}): {
    email: string;
    password: string;
  } {
    return {
      email: config.email || `admin-${faker.string.uuid()}@agrobridge.test`,
      password: config.password || 'SecureAdmin123!'
    };
  }

  /**
   * Generate invalid admin credentials
   */
  generateInvalidCredentials(): {
    email: string;
    password: string;
  } {
    return {
      email: 'invalid@nonexistent.test',
      password: 'WrongPassword123!'
    };
  }

  /**
   * Generate edge case credentials
   */
  generateEdgeCaseCredentials(): Array<{email: string; password: string; description: string}> {
    return [
      { email: '', password: 'ValidPass123!', description: 'Empty email' },
      { email: 'not-an-email', password: 'ValidPass123!', description: 'Invalid email format' },
      { email: 'a'.repeat(300) + '@test.com', password: 'ValidPass123!', description: 'Very long email' },
      { email: 'valid@test.com', password: '', description: 'Empty password' },
      { email: 'valid@test.com', password: '123', description: 'Short password' },
      { email: 'valid@test.com', password: 'a'.repeat(1000), description: 'Very long password' },
      { email: "<script>alert('xss')</script>@test.com", password: 'ValidPass123!', description: 'XSS in email' },
      { email: "admin' OR '1'='1'--@test.com", password: 'ValidPass123!', description: 'SQL injection in email' }
    ];
  }
}

/**
 * Singleton factory instance
 */
export const adminUserFactory = new AdminUserFactory();

/**
 * Create a test admin user (convenience function)
 */
export async function createTestAdmin(config: AdminUserConfig = {}): Promise<AdminUser> {
  return adminUserFactory.create(config);
}

/**
 * Create multiple test admin users (convenience function)
 */
export async function createTestAdmins(count: number, config: AdminUserConfig = {}): Promise<AdminUser[]> {
  return adminUserFactory.createMany(count, config);
}

/**
 * Clean up all test admins
 */
export async function cleanupTestAdmins(): Promise<void> {
  return adminUserFactory.cleanup();
}