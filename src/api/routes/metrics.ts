import type { FastifyInstance } from 'fastify';
import { register } from 'prom-client';

import { fail } from '../../http/response.js';

/**
 * Metrics routes - protected to prevent internal topology exposure.
 *
 * Authentication options (checked in order):
 * 1. Bearer token via Authorization header (for Prometheus scraper)
 * 2. Admin JWT cookie (for dashboard access)
 * 3. Skip auth in non-production if METRICS_AUTH_TOKEN is not set
 */
export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (req, reply) => {
    const metricsToken = app.env.METRICS_AUTH_TOKEN;

    // Option 1: Bearer token authentication (Prometheus scraper)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && metricsToken) {
      const token = authHeader.slice(7);
      if (token === metricsToken) {
        const metrics = await register.metrics();
        return reply.type(register.contentType).send(metrics);
      }
      reply.status(403);
      return fail({ code: 'FORBIDDEN', message: 'Invalid metrics token' });
    }

    // Option 2: Admin JWT cookie authentication (dashboard)
    try {
      await req.jwtVerify();
      const metrics = await register.metrics();
      return reply.type(register.contentType).send(metrics);
    } catch {
      // JWT verification failed, continue to fallback
    }

    // Option 3: In non-production without METRICS_AUTH_TOKEN, allow (dev convenience)
    if (!metricsToken && app.env.NODE_ENV !== 'production') {
      const metrics = await register.metrics();
      return reply.type(register.contentType).send(metrics);
    }

    // All auth methods failed
    reply.status(401);
    return fail({ code: 'UNAUTHORIZED', message: 'Authentication required for /metrics' });
  });
}
