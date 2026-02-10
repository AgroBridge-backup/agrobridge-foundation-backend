import type { FastifyInstance } from 'fastify';
import { register } from 'prom-client';

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_req, reply) => {
    const metrics = await register.metrics();
    reply.type(register.contentType).send(metrics);
  });
}
