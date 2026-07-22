import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../src/services/auth-service.js';

describe('AuthService', () => {
  it('rejects unknown user', async () => {
    const svc = new AuthService({
      findByEmail: async () => null,
      updateLastLogin: async () => {
        throw new Error('should not be called');
      },
    } as any);

    await expect(svc.login({ email: 'a@b.com', password: 'x' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('accepts valid password and returns claims', async () => {
    const hash = await bcrypt.hash('secret', 4);

    const svc = new AuthService({
      findByEmail: async () => ({
        id: 'u1',
        email: 'admin@x.com',
        passwordHash: hash,
        role: 'ADMIN',
      }),
      updateLastLogin: async () => ({ id: 'u1' }),
    } as any);

    const res = await svc.login({ email: 'ADMIN@x.com', password: 'secret' });
    expect(res).toEqual({ adminUserId: 'u1', email: 'admin@x.com', role: 'ADMIN' });
  });

  it('locks account when failed attempts reach threshold', async () => {
    const incrementFailedAttempts = vi.fn().mockResolvedValue({
      id: 'u1',
      failedAttempts: 5,
      lockedUntil: null,
    });
    const lockAccount = vi.fn().mockImplementation(async (_id: string, lockedUntil: Date) => ({
      id: 'u1',
      failedAttempts: 5,
      lockedUntil,
    }));

    const svc = new AuthService({
      incrementFailedAttempts,
      lockAccount,
    } as any);

    const result = await svc.recordFailedAttempt('u1');
    expect(incrementFailedAttempts).toHaveBeenCalledWith('u1');
    expect(lockAccount).toHaveBeenCalledOnce();
    expect(result.lockedUntil).toBeInstanceOf(Date);
  });

  it('does not lock account before threshold', async () => {
    const incrementFailedAttempts = vi.fn().mockResolvedValue({
      id: 'u1',
      failedAttempts: 3,
      lockedUntil: null,
    });
    const lockAccount = vi.fn();

    const svc = new AuthService({
      incrementFailedAttempts,
      lockAccount,
    } as any);

    const result = await svc.recordFailedAttempt('u1');
    expect(lockAccount).not.toHaveBeenCalled();
    expect(result.failedAttempts).toBe(3);
  });

  it('resets failed attempts on successful login reset path', async () => {
    const resetFailedAttempts = vi.fn().mockResolvedValue({
      id: 'u1',
      failedAttempts: 0,
      lockedUntil: null,
    });
    const svc = new AuthService({
      resetFailedAttempts,
    } as any);

    await svc.resetFailedAttempts('u1');
    expect(resetFailedAttempts).toHaveBeenCalledWith('u1');
  });
});
