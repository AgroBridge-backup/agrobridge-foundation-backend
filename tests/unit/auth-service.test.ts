import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';

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
});
