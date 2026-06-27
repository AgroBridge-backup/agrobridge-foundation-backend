import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookEventRepository } from '../../src/repositories/webhook-event-repo.js';
import { createMockPrismaClient } from '../mocks/prisma-mock.js';
import { webhookEventFixtures } from '../fixtures/data-fixtures.js';

describe('WebhookEventRepository', () => {
  let mockPrisma: any;
  let repo: WebhookEventRepository;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    repo = new WebhookEventRepository(mockPrisma);
    vi.clearAllMocks();
  });

  describe('createIfNotExists', () => {
    it('creates a new event and reports not-yet-processed', async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue(webhookEventFixtures.unprocessed);

      const result = await repo.createIfNotExists({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        rawPayload: '{"id":"evt_test_123"}',
      });

      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: {
          id: 'evt_test_123',
          type: 'checkout.session.completed',
          rawPayload: '{"id":"evt_test_123"}',
          processed: false,
        },
      });
      expect(result).toEqual({ created: true, alreadyProcessed: false });
    });

    it('reports alreadyProcessed when a duplicate event was fully processed', async () => {
      const error = new Error('Unique constraint violation') as any;
      error.code = 'P2002';
      mockPrisma.webhookEvent.create.mockRejectedValue(error);
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ processed: true });

      const result = await repo.createIfNotExists({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        rawPayload: '{"id":"evt_test_123"}',
      });

      expect(mockPrisma.webhookEvent.findUnique).toHaveBeenCalledWith({
        where: { id: 'evt_test_123' },
        select: { processed: true },
      });
      expect(result).toEqual({ created: false, alreadyProcessed: true });
    });

    it('reports NOT processed when a duplicate exists but a prior attempt crashed (replay safety)', async () => {
      // The event row exists from a previous attempt that inserted it but never
      // committed its work. Stripe retries — we must NOT skip; the caller
      // re-processes. Previously this returned alreadyProcessed:true and lost the work.
      const error = new Error('Unique constraint violation') as any;
      error.code = 'P2002';
      mockPrisma.webhookEvent.create.mockRejectedValue(error);
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ processed: false });

      const result = await repo.createIfNotExists({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        rawPayload: '{"id":"evt_test_123"}',
      });

      expect(result).toEqual({ created: false, alreadyProcessed: false });
    });

    it('rethrows non-unique constraint errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.webhookEvent.create.mockRejectedValue(error);

      await expect(
        repo.createIfNotExists({
          id: 'evt_test_123',
          type: 'checkout.session.completed',
          rawPayload: '{"id":"evt_test_123"}',
        }),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('markProcessed', () => {
    it('should mark webhook event as processed', async () => {
      mockPrisma.webhookEvent.update.mockResolvedValue({
        ...webhookEventFixtures.unprocessed,
        processed: true,
      });

      const result = await repo.markProcessed('evt_test_123');

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt_test_123' },
        data: { processed: true },
      });
      expect(result.processed).toBe(true);
    });
  });
});
