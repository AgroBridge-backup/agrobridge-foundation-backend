import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/setup-db.js';
import { setTestEnv } from '../../helpers/env.js';
import type { FastifyInstance } from 'fastify';

describe('Authentication Flow Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    setTestEnv();
    await setupTestDatabase();
    app = await buildApp({ logger: false });
    await app.ready();

    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = await bcrypt.hash('test-password', 10);

    await app.prisma.adminUser.create({
      data: {
        email: 'admin@agrobridge.org',
        passwordHash,
        role: 'ADMIN',
      },
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await teardownTestDatabase();
  });

  it('should login successfully with valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@agrobridge.org',
        password: 'test-password',
      },
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.ok).toBe(true);
    expect(data.data).toEqual({});
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('should fail login with invalid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@agrobridge.org',
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    const data = response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('should fail login with non-existent user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'nonexistent@example.com',
        password: 'test-password',
      },
    });

    expect(response.statusCode).toBe(401);
    const data = response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('should require authentication for protected routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
    });

    expect(response.statusCode).toBe(401);
    const data = response.json();
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });
});
