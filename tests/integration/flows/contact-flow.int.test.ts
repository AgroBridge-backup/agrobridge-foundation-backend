import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/setup-db.js';
import type { FastifyInstance } from 'fastify';

describe('Contact Form Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDatabase();
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await app.prisma.contactRequest.deleteMany();
  });

  afterEach(async () => {
    const count = await app.prisma.contactRequest.count();
    expect(count).toBe(0);
  });

  describe('Successful submission', () => {
    it('should submit contact form successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'John Doe',
          email: 'john@example.com',
          message: 'This is a test message',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);

      const contactRequest = await app.prisma.contactRequest.findFirst();
      expect(contactRequest).toBeDefined();
      expect(contactRequest?.name).toBe('John Doe');
      expect(contactRequest?.email).toBe('john@example.com');
      expect(contactRequest?.message).toBe('This is a test message');
      expect(contactRequest?.status).toBe('NEW');
    });
  });

  describe('Validation errors', () => {
    it('should validate email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'John Doe',
          email: 'invalid-email',
          message: 'Test message',
        },
      });

      expect(response.statusCode).toBe(422);
      const data = response.json();
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'John Doe',
        },
      });

      expect(response.statusCode).toBe(422);
      const data = response.json();
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate message length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: {
          name: 'John Doe',
          email: 'john@example.com',
          message: 'x'.repeat(10001),
        },
      });

      expect(response.statusCode).toBe(422);
      const data = response.json();
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Duplicate submissions', () => {
    it('should allow duplicate submissions from same email', async () => {
      const payload = {
        name: 'John Doe',
        email: 'john@example.com',
        message: 'Test message',
      };

      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload,
      });

      expect(firstResponse.statusCode).toBe(200);

      const secondResponse = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { ...payload, message: 'Another message' },
      });

      expect(secondResponse.statusCode).toBe(200);

      const count = await app.prisma.contactRequest.count({
        where: { email: 'john@example.com' },
      });

      expect(count).toBe(2);
    });
  });
});
