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
          await this.prisma.webhookEvent.create({
            data: {
              id: input.id,
              type: input.type,
              rawPayload: input.rawPayload,
              processed: false,
            },
          });
          return { created: true, alreadyProcessed: false };
        } catch (err) {
          // Unique constraint violation -> the event row already exists. It is
          // NOT safe to assume it was processed: a prior attempt may have
          // crashed after inserting the row but before completing (and
          // committing) the work. Read the actual processed flag so the caller
          // can re-process an unfinished event on Stripe's retry.
          const code = (err as { code?: string }).code;
          if (code === 'P2002') {
            const existing = await this.prisma.webhookEvent.findUnique({
              where: { id: input.id },
              select: { processed: true },
            });
            return { created: false, alreadyProcessed: Boolean(existing?.processed) };
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
