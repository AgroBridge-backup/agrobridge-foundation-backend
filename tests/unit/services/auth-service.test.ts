import bcrypt from 'bcryptjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthService } from '../../../src/services/auth-service.js';

// Lower cost factor for faster tests while still testing timing consistency
const TEST_BCRYPT_COST = 4;

describe('AuthService - Timing Attack Mitigation', () => {
  let mockRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    updateLastLogin: ReturnType<typeof vi.fn>;
    incrementFailedAttempts: ReturnType<typeof vi.fn>;
    lockAccount: ReturnType<typeof vi.fn>;
    resetFailedAttempts: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      findByEmail: vi.fn(),
      updateLastLogin: vi.fn().mockResolvedValue({ id: 'u1' }),
      incrementFailedAttempts: vi.fn(),
      lockAccount: vi.fn(),
      resetFailedAttempts: vi.fn(),
    };
  });

  describe('Constant-Time Authentication', () => {
    it('should perform bcrypt comparison even when user not found', async () => {
      const compareSpy = vi.spyOn(bcrypt, 'compare');
      
      mockRepo.findByEmail.mockResolvedValue(null);
      
      const svc = new AuthService(mockRepo as any);
      
      await expect(
        svc.login({ email: 'unknown@example.com', password: 'x' })
      ).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });

      // SECURITY: bcrypt.compare MUST be called even for non-existent users
      expect(compareSpy).toHaveBeenCalledTimes(1);
      expect(compareSpy).toHaveBeenCalledWith(
        'x',
        expect.stringContaining('$2a$12$')
      );

      compareSpy.mockRestore();
    }, 10000);

    it('should use dummy hash comparison for deleted users', async () => {
      const compareSpy = vi.spyOn(bcrypt, 'compare');
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'deleted@example.com',
        passwordHash: '$2a$12$realhashhere',
        role: 'ADMIN',
        deletedAt: new Date(),
      });
      
      const svc = new AuthService(mockRepo as any);
      
      await expect(
        svc.login({ email: 'deleted@example.com', password: 'password' })
      ).rejects.toMatchObject({
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });

      // SECURITY: Should use dummy hash, not real password hash for deleted users
      expect(compareSpy).toHaveBeenCalledTimes(1);
      const [_, hashArg] = compareSpy.mock.calls[0];
      expect(hashArg).toContain('$2a$12$abcdefghijklmnopqrstuvwx');

      compareSpy.mockRestore();
    }, 10000);

    it('should have consistent timing for valid user with wrong password', async () => {
      const realHash = await bcrypt.hash('correctpassword', TEST_BCRYPT_COST);
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        passwordHash: realHash,
        role: 'ADMIN',
        deletedAt: null,
      });
      
      const svc = new AuthService(mockRepo as any);
      
      const timings: number[] = [];
      
      // Measure timing for wrong password
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        try {
          await svc.login({ email: 'user@example.com', password: 'wrongpassword' });
        } catch {
          // Expected to fail
        }
        timings.push(performance.now() - start);
      }

      // Calculate statistics
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      
      // SECURITY: Standard deviation should be reasonable indicating consistent timing
      expect(stdDev).toBeLessThan(50);
      
      // All requests should take at least some time (bcrypt + jitter)
      timings.forEach(t => {
        expect(t).toBeGreaterThan(20);
      });
    }, 15000);

    it('should have similar timing for non-existent user vs wrong password', async () => {
      const realHash = await bcrypt.hash('correctpassword', TEST_BCRYPT_COST);
      
      const svc = new AuthService(mockRepo as any);
      
      const nonExistentTimings: number[] = [];
      const wrongPasswordTimings: number[] = [];
      
      // Measure non-existent user timing
      mockRepo.findByEmail.mockResolvedValue(null);
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        try {
          await svc.login({ email: 'nonexistent@example.com', password: 'password' });
        } catch {
          // Expected
        }
        nonExistentTimings.push(performance.now() - start);
      }
      
      // Measure wrong password timing
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'exists@example.com',
        passwordHash: realHash,
        role: 'ADMIN',
        deletedAt: null,
      });
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        try {
          await svc.login({ email: 'exists@example.com', password: 'wrongpassword' });
        } catch {
          // Expected
        }
        wrongPasswordTimings.push(performance.now() - start);
      }
      
      // Calculate averages
      const nonExistentAvg = nonExistentTimings.reduce((a, b) => a + b, 0) / nonExistentTimings.length;
      const wrongPasswordAvg = wrongPasswordTimings.reduce((a, b) => a + b, 0) / wrongPasswordTimings.length;
      
      // SECURITY: Timing difference should be minimal (< 40ms)
      const timingDifference = Math.abs(nonExistentAvg - wrongPasswordAvg);
      expect(timingDifference).toBeLessThan(40);
    }, 15000);
  });

  describe('Error Message Consistency', () => {
    it('should return identical error for non-existent user and wrong password', async () => {
      const realHash = await bcrypt.hash('password', TEST_BCRYPT_COST);
      
      mockRepo.findByEmail.mockResolvedValue(null);
      const svc = new AuthService(mockRepo as any);
      
      let nonExistentError: any;
      let wrongPasswordError: any;
      
      try {
        await svc.login({ email: 'unknown@example.com', password: 'pass' });
      } catch (e) {
        nonExistentError = e;
      }
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'exists@example.com',
        passwordHash: realHash,
        role: 'ADMIN',
        deletedAt: null,
      });
      
      try {
        await svc.login({ email: 'exists@example.com', password: 'wrong' });
      } catch (e) {
        wrongPasswordError = e;
      }
      
      // SECURITY: Error messages must be identical to prevent information leakage
      expect(nonExistentError.statusCode).toBe(wrongPasswordError.statusCode);
      expect(nonExistentError.code).toBe(wrongPasswordError.code);
      expect(nonExistentError.message).toBe(wrongPasswordError.message);
    }, 10000);

    it('should return identical error for deleted user', async () => {
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'deleted@example.com',
        passwordHash: '$2a$12$realhash',
        role: 'ADMIN',
        deletedAt: new Date(),
      });
      
      const svc = new AuthService(mockRepo as any);
      
      let deletedUserError: any;
      
      try {
        await svc.login({ email: 'deleted@example.com', password: 'correct' });
      } catch (e) {
        deletedUserError = e;
      }
      
      expect(deletedUserError.statusCode).toBe(401);
      expect(deletedUserError.code).toBe('UNAUTHORIZED');
    }, 10000);
  });

  describe('Jitter Implementation', () => {
    it('should add minimum processing time to prevent fast rejections', async () => {
      mockRepo.findByEmail.mockResolvedValue(null);
      
      const svc = new AuthService(mockRepo as any);
      
      const timings: number[] = [];
      
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        try {
          await svc.login({ email: 'test@example.com', password: 'x' });
        } catch {
          // Expected
        }
        timings.push(performance.now() - start);
      }
      
      // SECURITY: All requests should take at least some time
      // This prevents attackers from detecting "fast path" rejections
      timings.forEach(t => {
        expect(t).toBeGreaterThanOrEqual(20);
      });
    }, 10000);

    it('should have variable timing within acceptable range (jitter working)', async () => {
      const realHash = await bcrypt.hash('password', TEST_BCRYPT_COST);
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        passwordHash: realHash,
        role: 'ADMIN',
        deletedAt: null,
      });
      
      const svc = new AuthService(mockRepo as any);
      
      const timings: number[] = [];
      
      // Collect samples to detect jitter variance
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        try {
          await svc.login({ email: 'user@example.com', password: 'wrong' });
        } catch {
          // Expected
        }
        timings.push(performance.now() - start);
      }
      
      // Calculate range
      const min = Math.min(...timings);
      const max = Math.max(...timings);
      const range = max - min;
      
      // SECURITY: Jitter should create some variance but not too much
      // Note: Jitter is random (10-30ms), so we just verify there's some range
      // and it's within acceptable bounds (not zero variance, not excessive)
      expect(range).toBeGreaterThanOrEqual(0.5);  // Some variance indicates jitter
      expect(range).toBeLessThan(100);  // Not excessive variance
    }, 20000);
  });

  describe('Successful Authentication', () => {
    it('should succeed with correct credentials and update last login', async () => {
      const realHash = await bcrypt.hash('correctpassword', TEST_BCRYPT_COST);
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'admin@example.com',
        passwordHash: realHash,
        role: 'ADMIN',
        deletedAt: null,
      });
      
      const svc = new AuthService(mockRepo as any);
      
      const result = await svc.login({ 
        email: 'admin@example.com', 
        password: 'correctpassword' 
      });
      
      expect(result).toEqual({
        adminUserId: 'u1',
        email: 'admin@example.com',
        role: 'ADMIN',
      });
      
      expect(mockRepo.updateLastLogin).toHaveBeenCalledWith('u1', expect.any(Date));
    }, 10000);

    it('should normalize email to lowercase', async () => {
      const realHash = await bcrypt.hash('password', TEST_BCRYPT_COST);
      
      mockRepo.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@example.com',
        passwordHash: realHash,
        role: 'USER',
        deletedAt: null,
      });
      
      const svc = new AuthService(mockRepo as any);
      
      await svc.login({ email: 'USER@EXAMPLE.COM', password: 'password' });
      
      expect(mockRepo.findByEmail).toHaveBeenCalledWith('user@example.com');
    }, 10000);
  });
});
