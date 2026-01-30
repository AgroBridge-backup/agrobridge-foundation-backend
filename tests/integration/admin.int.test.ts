import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { buildApp } from '../../src/app.js';
import { signAdminCookie } from '../helpers/admin-cookie.js';
import { setTestEnv } from '../helpers/env.js';
import { startTestDb, stopTestDb } from './test-db.js';

let prisma: PrismaClient;

describe('Integration admin endpoints', { skip: !process.env.DOCKER_HOST && !process.env.TESTCONTAINERS_HOST_OVERRIDE }, () => {
  beforeAll(async () => {
    setTestEnv();
    const started = await startTestDb();
    prisma = started.prisma;

    // Seed donations
    await prisma.donation.createMany({
      data: [
        { amount: 100, currency: 'usd', status: 'SUCCEEDED', donorEmail: 'a@x.com', stripeSessionId: 'cs_a' },
        { amount: 200, currency: 'usd', status: 'SUCCEEDED', donorEmail: 'b@x.com', stripeSessionId: 'cs_b' },
        { amount: 300, currency: 'usd', status: 'PENDING', donorEmail: 'a@x.com', stripeSessionId: 'cs_c' },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it('GET /api/admin/donations paginates and filters', async () => {
    const app = buildApp({ logger: false });
    const token = await app.jwt.sign({ sub: 'admin1', email: 'admin@x.com', role: 'ADMIN' }, { expiresIn: '24h' });
    const cookie = await signAdminCookie(app, token);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/donations?page=1&pageSize=2&status=SUCCEEDED&sort=createdAt:desc',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.items.length).toBe(2);
    expect(body.data.meta).toMatchObject({ page: 1, pageSize: 2, total: 2, totalPages: 1 });
  });

  it('GET /api/admin/dashboard computes aggregates', async () => {
    const app = buildApp({ logger: false });
    const token = await app.jwt.sign({ sub: 'admin1', email: 'admin@x.com', role: 'ADMIN' }, { expiresIn: '24h' });
    const cookie = await signAdminCookie(app, token);

    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // totalRaised sums succeeded amounts only
    expect(body.data.totalRaised).toBe(300);
    expect(body.data.donationCount).toBe(3);
    // distinct donorEmail among all donations where donorEmail not null
    expect(body.data.donorCount).toBe(2);
    expect(body.data.lastDonationAt).not.toBeNull();
  });
});
