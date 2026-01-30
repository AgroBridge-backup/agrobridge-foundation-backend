import { z } from 'zod';

import { Errors } from '../errors/app-error.js';
import { DonationRepository } from '../repositories/donation-repo.js';
import { TtlCache } from './admin-dashboard-cache.js';

export type AdminDashboardMetrics = {
  totalRaised: number;
  donationCount: number;
  donorCount: number;
  lastDonationAt: Date | null;
};

const inputSchema = z.object({
  ttlMs: z.number().int().min(1).max(60_000).default(15_000),
});

export class AdminDashboardService {
  private readonly cache = new TtlCache<AdminDashboardMetrics>();

  constructor(private readonly donations: DonationRepository) {}

  async getMetrics(input?: { ttlMs?: number }): Promise<AdminDashboardMetrics> {
    const parsed = inputSchema.safeParse(input ?? {});
    if (!parsed.success) throw Errors.validation(parsed.error.flatten());

    const cached = this.cache.get();
    if (cached) return cached;

    const { succeededAgg, donationCount, lastDonation, donorCount } =
      await this.donations.dashboardMetrics();

    const metrics: AdminDashboardMetrics = {
      totalRaised: succeededAgg._sum.amount ?? 0,
      donationCount,
      donorCount,
      lastDonationAt: lastDonation?.createdAt ?? null,
    };

    this.cache.set(metrics, parsed.data.ttlMs);
    return metrics;
  }
}
