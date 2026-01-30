import { describe, expect, it } from 'vitest';

import { AdminDashboardService } from '../../src/services/admin-dashboard-service.js';

describe('AdminDashboardService cache', () => {
  it('caches metrics within TTL', async () => {
    let calls = 0;
    const repo = {
      dashboardMetrics: async () => {
        calls++;
        return {
          succeededAgg: { _sum: { amount: 100 } },
          donationCount: 1,
          lastDonation: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
          donorCount: 1,
        };
      },
    } as any;

    const svc = new AdminDashboardService(repo);

    const a = await svc.getMetrics({ ttlMs: 60_000 });
    const b = await svc.getMetrics({ ttlMs: 60_000 });

    expect(a).toEqual(b);
    expect(calls).toBe(1);
  });
});
