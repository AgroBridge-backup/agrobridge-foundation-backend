import type { PrismaClient } from '@prisma/client';

import { withDbSpan } from '../observability/db-span.js';

export class WebhookEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createIfNotExists(input: { id: string; type: string; rawPayload: string }) {
    return withDbSpan({
      name: 'db.webhook_event.create_if_not_exists',
      model: 'WebhookEvent',
      operation: 'create',
      fn: async () => {
        try {
          const created = await this.prisma.webhookEvent.create({
            data: {
              id: input.id,
              type: input.type,
              rawPayload: input.rawPayload,
              processed: false,
            },
          });
          return { created, alreadyProcessed: false };
        } catch (err) {
          // Unique constraint violation -> idempotent ack
          const code = (err as { code?: string }).code;
          if (code === 'P2002') {
            return { created: null, alreadyProcessed: true } as const;
          }
          throw err;
        }
      },
    });
  }

  markProcessed(id: string) {
    return withDbSpan({
      name: 'db.webhook_event.mark_processed',
      model: 'WebhookEvent',
      operation: 'update',
      fn: async () => this.prisma.webhookEvent.update({ where: { id }, data: { processed: true } }),
    });
  }
}
