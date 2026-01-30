import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    timestamp: z.string().datetime(),
  }),
});

export const healthRouteSchema = {
  summary: 'Health Check',
  description: 'Check API health status',
  tags: ['Health'],
  response: {
    200: healthResponseSchema,
  },
};
