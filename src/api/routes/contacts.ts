import type { FastifyInstance } from 'fastify';

import { ok } from '../../http/response.js';
import { ContactRequestRepository } from '../../repositories/contact-request-repo.js';
import { ContactService } from '../../services/contact-service.js';

export async function contactRoutes(app: FastifyInstance) {
  app.post('/contacts', async (req, reply) => {
    const service = new ContactService(new ContactRequestRepository(app.prisma));
    const data = await service.create(req.body);
    reply.status(201);
    return ok(data);
  });
}
