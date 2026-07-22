import type { FastifyInstance } from 'fastify';

import { requireAdmin } from '../../auth/jwt.js';
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

  app.get('/health/deep', async (req, reply) => {
    await requireAdmin(req);

    const startedAt = Date.now();
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      const durationMs = Date.now() - startedAt;
      return ok({
        status: 'ok',
        db: 'ok',
        durationMs,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    } catch {
      const durationMs = Date.now() - startedAt;
      reply.status(503);
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'DB unavailable', details: { durationMs } },
      };
    }
  });

  // Rate limit health check endpoints
  const store = getTieredRateLimiter().getStore();
  registerHealthCheckEndpoint(app, store, { requireDeepAuth: requireAdmin });
}
