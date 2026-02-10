import type { FastifyInstance } from 'fastify';

import { ok } from '../../http/response.js';
import { registerHealthCheckEndpoint } from '../../rate-limiting/health-check.js';
import { getTieredRateLimiter } from '../../rate-limiting/tiered-rate-limiter.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    // Liveness + shallow readiness.
    // Keep this fast and side-effect free.
    const startedAt = Date.now();
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      const durationMs = Date.now() - startedAt;
      return ok({ status: 'ok', db: 'ok', durationMs });
    } catch {
      const durationMs = Date.now() - startedAt;
      // Health must reflect dependency readiness.
      reply.status(503);
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'DB unavailable', details: { durationMs } },
      };
    }
  });

  // Rate limit health check endpoints
  const store = getTieredRateLimiter().getStore();
  registerHealthCheckEndpoint(app, store);
}
