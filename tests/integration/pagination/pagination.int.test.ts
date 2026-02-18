import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/setup-db.js';
import { setTestEnv } from '../../helpers/env.js';
import type { FastifyInstance } from 'fastify';
import { seedDonations } from '../../helpers/seed-data.js';
import { getAdminCookie } from '../../helpers/admin-cookie.js';

describe('Pagination Integration Tests', () => {
  let app: FastifyInstance;
  let adminCookie: string;

  beforeAll(async () => {
    setTestEnv();
    await setupTestDatabase();
    app = await buildApp({ logger: false });
    await app.ready();
    adminCookie = await getAdminCookie(app);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await app.prisma.donation.deleteMany();
    await app.prisma.contactRequest.deleteMany();
    await app.prisma.adminUser.deleteMany();
    await app.prisma.webhookEvent.deleteMany();
  });

  afterEach(async () => {
    await app.prisma.donation.deleteMany();
    await app.prisma.contactRequest.deleteMany();
    await app.prisma.adminUser.deleteMany();
    await app.prisma.webhookEvent.deleteMany();
  });

  describe('Offset pagination', () => {
    it('should handle first page correctly', async () => {
      await app.prisma.donation.createMany({ data: await seedDonations(50) });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?page=1&pageSize=25',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items).toHaveLength(25);
      expect(data.data.meta.page).toBe(1);
      expect(data.data.meta.total).toBe(50);
    });

    it('should handle last page with fewer items', async () => {
      await app.prisma.donation.createMany({ data: await seedDonations(75) });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?page=3&pageSize=25',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items.length).toBeLessThanOrEqual(25);
      expect(data.data.meta.totalPages).toBe(3);
    });

    it('should handle empty results', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?page=1&pageSize=25',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items).toHaveLength(0);
      expect(data.data.meta.total).toBe(0);
    });

    it('should filter by status', async () => {
      const allDonations = await seedDonations(30);
      await app.prisma.donation.createMany({ data: allDonations });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?page=1&pageSize=25&status=SUCCEEDED',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      data.data.items.forEach((item: any) => {
        expect(item.status).toBe('SUCCEEDED');
      });
    });
  });

  describe('Cursor pagination', () => {
    it('should handle first page correctly', async () => {
      await app.prisma.donation.createMany({ data: await seedDonations(100) });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?mode=cursor&pageSize=25',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items).toHaveLength(25);
      expect(data.data.meta.nextCursor).not.toBeNull();
    });

    it('should handle last page (no nextCursor)', async () => {
      const donations = await seedDonations(25);
      await app.prisma.donation.createMany({ data: donations });

      const firstPageResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?mode=cursor&pageSize=25',
        headers: { cookie: adminCookie },
      });

      const firstPageData = firstPageResponse.json();
      const lastCursor = firstPageData.data.meta.nextCursor;

      const secondPageResponse = await app.inject({
        method: 'GET',
        url: `/api/admin/donations?mode=cursor&pageSize=25&cursor=${lastCursor}`,
        headers: { cookie: adminCookie },
      });

      expect(secondPageResponse.statusCode).toBe(200);
      const secondPageData = secondPageResponse.json();
      expect(secondPageData.data.items).toHaveLength(0);
      expect(secondPageData.data.meta.nextCursor).toBeNull();
    });

    it('should handle empty result set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?mode=cursor&pageSize=25',
        headers: { cookie: adminCookie },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items).toHaveLength(0);
      expect(data.data.meta.nextCursor).toBeNull();
    });
  });

  describe('Large dataset pagination', () => {
    it('should handle 1000+ records with cursor pagination', async () => {
      await app.prisma.donation.createMany({ data: await seedDonations(1000) });

      const start = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/donations?mode=cursor&pageSize=50',
        headers: { cookie: adminCookie },
      });
      const duration = Date.now() - start;

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ok).toBe(true);
      expect(data.data.items).toHaveLength(50);
      expect(duration).toBeLessThan(2000);
    });
  });
});
