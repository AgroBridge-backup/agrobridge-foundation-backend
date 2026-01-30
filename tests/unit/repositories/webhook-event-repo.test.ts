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
    it('should create webhook event if not exists', async () => {
      mockPrisma.webhookEvent.create.mockResolvedValue(webhookEventFixtures.processed);

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
      expect(result).toEqual({
        created: webhookEventFixtures.processed,
        alreadyProcessed: false,
      });
    });

    it('should return alreadyProcessed true on unique constraint violation', async () => {
      const error = new Error('Unique constraint violation') as any;
      error.code = 'P2002';
      mockPrisma.webhookEvent.create.mockRejectedValue(error);

      const result = await repo.createIfNotExists({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        rawPayload: '{"id":"evt_test_123"}',
      });

      expect(result).toEqual({
        created: null,
        alreadyProcessed: true,
      });
    });

    it('should rethrow non-unique constraint errors', async () => {
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
