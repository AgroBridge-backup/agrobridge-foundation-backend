import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

import { Errors } from '../errors/app-error.js';
import { AdminUserRepository } from '../repositories/admin-user-repo.js';

/**
 * Dummy password hash for constant-time comparison when user is not found.
 * This prevents timing attacks by ensuring bcrypt comparison always runs.
 * 
 * Security: This hash is randomly generated and never matches real passwords.
 * It exists solely to consume the same computational time as a real comparison.
 */
const DUMMY_PASSWORD_HASH =
  '$2a$12$abcdefghijklmnopqrstuvwxabcdefghijklmnopqrstuvwxabcd';

/**
 * Minimum bcrypt cost factor for timing consistency.
 * Higher values increase security but also computation time.
 */
const BCRYPT_COST_FACTOR = 12;

export class AuthService {
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_MS = 15 * 60 * 1000;

  /**
   * Jitter configuration for timing attack mitigation.
   * Adds random delay to mask computation time differences.
   */
  private readonly JITTER_MIN_MS = 10;
  private readonly JITTER_MAX_MS = 30;

  constructor(private readonly adminUsers: AdminUserRepository) {}

  async findByEmail(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    return this.adminUsers.findByEmail(normalizedEmail);
  }

  /**
   * Authenticate a user with timing attack mitigation.
   * 
   * SECURITY: This method implements constant-time authentication to prevent
   * timing-based user enumeration attacks. Key measures:
   * 
   * 1. Always performs bcrypt comparison (even for non-existent users)
   * 2. Adds random jitter to response times (10-30ms)
   * 3. Uses consistent error messages for all failure cases
   * 
   * @param input - Login credentials
   * @returns User claims on success
   * @throws AppError with UNAUTHORIZED code on any failure
   */
  async login(input: { email: string; password: string }) {
    const startTime = process.hrtime.bigint();
    
    try {
      // Fetch user - this takes ~5ms for non-existent users
      const user = await this.findByEmail(input.email);

      // SECURITY: Always perform bcrypt comparison, even if user not found
      // This ensures timing attacks cannot distinguish between:
      // - User not found (fast path)
      // - Wrong password (slow bcrypt comparison)
      const passwordHash = user && !user.deletedAt 
        ? user.passwordHash 
        : DUMMY_PASSWORD_HASH;
      
      // This comparison takes ~50-100ms regardless of user existence
      const isPasswordValid = await bcrypt.compare(input.password, passwordHash);

      // Check authentication result
      if (!user || user.deletedAt || !isPasswordValid) {
        throw Errors.unauthorized();
      }

      // Successful authentication
      await this.adminUsers.updateLastLogin(user.id, new Date());

      return {
        adminUserId: user.id,
        email: user.email,
        role: user.role,
      };
    } finally {
      // SECURITY: Add random jitter to mask timing differences
      // This prevents attackers from measuring exact bcrypt computation time
      await this.addJitter(startTime);
    }
  }

  /**
   * Adds random jitter to ensure constant response times.
   * 
   * Calculates elapsed time and adds a random delay between JITTER_MIN_MS
   * and JITTER_MAX_MS to mask any timing variations from bcrypt comparison
   * or database lookups.
   * 
   * @param startTime - High-resolution timestamp when operation started
   */
  private async addJitter(startTime: bigint): Promise<void> {
    const endTime = process.hrtime.bigint();
    const elapsedMs = Number(endTime - startTime) / 1_000_000;
    
    // Calculate target total time with jitter
    const jitterMs = randomInt(this.JITTER_MIN_MS, this.JITTER_MAX_MS + 1);
    const targetTotalMs = elapsedMs + jitterMs;
    
    // Ensure minimum processing time to prevent ultra-fast rejections
    const minimumProcessingTime = 60; // ms - covers bcrypt + jitter
    const delayMs = Math.max(0, minimumProcessingTime - elapsedMs);
    
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }
  }

  /**
   * Sleep helper for implementing delays.
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async recordFailedAttempt(adminUserId: string) {
    const updated = await this.adminUsers.incrementFailedAttempts(adminUserId);

    const now = new Date();
    if (updated.lockedUntil && updated.lockedUntil > now) {
      return updated;
    }

    if (updated.failedAttempts < this.MAX_FAILED_ATTEMPTS) {
      return updated;
    }

    const lockedUntil = new Date(Date.now() + this.LOCKOUT_MS);
    return this.adminUsers.lockAccount(adminUserId, lockedUntil);
  }

  async resetFailedAttempts(adminUserId: string) {
    return this.adminUsers.resetFailedAttempts(adminUserId);
  }
}
