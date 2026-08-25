import type { FastifyInstance } from 'fastify';

import { requireAdmin } from '../../auth/jwt.js';
import { getRedisClient } from '../../cache/redis-client.js';
import { ok } from '../../http/response.js';
import { registerHealthCheckEndpoint } from '../../rate-limiting/health-check.js';
import { getTieredRateLimiter } from '../../rate-limiting/tiered-rate-limiter.js';

/**
 * Shallow dependency probes for the readiness check.
 *
 * The health endpoint backs the load-balancer readiness gate, so the checks
 * must be fast and side-effect free. We run a `SELECT 1` against Postgres and
 * a `PING` against Redis in parallel and reflect each independently. A Redis
 * outage is a hard dependency for the donation pipeline (idempotency fails
 * open when Redis is down), so it must surface here rather than return a
 * misleading 200.
 *
 * Only boolean/string status is reported — never connection strings, host
 * names, or error payloads (avoids leaking infrastructure details).
 */
async function runReadinessChecks(app: FastifyInstance): Promise<{
  dbOk: boolean;
  redisOk: boolean;
  durationMs: number;
}> {
  const startedAt = Date.now();

  const [dbResult, redisResult] = await Promise.allSettled([
    app.prisma.$queryRaw`SELECT 1`,
    getRedisClient(app.env).ping(),
  ]);

  return {
    dbOk: dbResult.status === 'fulfilled',
    redisOk: redisResult.status === 'fulfilled',
    durationMs: Date.now() - startedAt,
  };
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    // Liveness + shallow readiness.
    // Keep this fast and side-effect free.
    const { dbOk, redisOk, durationMs } = await runReadinessChecks(app);

    if (dbOk && redisOk) {
      return ok({ status: 'ok', db: 'ok', redis: 'ok', durationMs });
    }

    // Health must reflect dependency readiness.
    reply.status(503);
    return {
      ok: false,
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
      durationMs,
    };
  });

  app.get('/health/deep', async (req, reply) => {
    await requireAdmin(req);

    const { dbOk, redisOk, durationMs } = await runReadinessChecks(app);

    if (dbOk && redisOk) {
      return ok({
        status: 'ok',
        db: 'ok',
        redis: 'ok',
        durationMs,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    }

    reply.status(503);
    return {
      ok: false,
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
      durationMs,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  // Rate limit health check endpoints
  const store = getTieredRateLimiter().getStore();
  registerHealthCheckEndpoint(app, store, { requireDeepAuth: requireAdmin });
}
