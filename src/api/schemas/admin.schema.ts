import { z } from 'zod';

export const listDonationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING', 'SUCCEEDED', 'EXPIRED']).optional(),
  sort: z.enum(['createdAt:asc', 'createdAt:desc']).default('createdAt:desc'),
  cursor: z.string().optional(),
  mode: z.enum(['offset', 'cursor']).default('offset'),
});

export const donationSchema = z.object({
  id: z.string().uuid(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'EXPIRED']),
  donorEmail: z.string().email().nullable(),
  stripeSessionId: z.string().nullable(),
  metadata: z.record(z.string(), z.any()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DonationStatus = 'PENDING' | 'SUCCEEDED' | 'EXPIRED';

export const listDonationsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.union([
    z.object({
      items: z.array(donationSchema),
      meta: z.object({
        mode: z.literal('offset'),
        page: z.number(),
        pageSize: z.number(),
        total: z.number(),
        totalPages: z.number(),
      }),
    }),
    z.object({
      items: z.array(donationSchema),
      meta: z.object({
        mode: z.literal('cursor'),
        pageSize: z.number(),
        nextCursor: z.string().nullable(),
      }),
    }),
  ]),
});

export const dashboardMetricsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    totalDonations: z.number(),
    totalAmount: z.number(),
    uniqueDonors: z.number(),
    lastDonationAt: z.string().datetime().nullable(),
  }),
});

export const listDonationsRouteSchema = {
  summary: 'List Donations (Admin)',
  description: 'List donations with pagination, filtering, and sorting',
  tags: ['Admin'],
  security: [{ cookieAuth: [] }],
  querystring: listDonationsQuerySchema,
  response: {
    200: listDonationsResponseSchema,
    401: z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.literal('UNAUTHORIZED'),
        message: z.string(),
      }),
    }),
  },
};

export const dashboardMetricsRouteSchema = {
  summary: 'Dashboard Metrics (Admin)',
  description: 'Get aggregated donation metrics for admin dashboard',
  tags: ['Admin'],
  security: [{ cookieAuth: [] }],
  response: {
    200: dashboardMetricsResponseSchema,
  },
};
