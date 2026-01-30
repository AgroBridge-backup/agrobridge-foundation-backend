import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactRequestRepository } from '../../src/repositories/contact-request-repo';
import { createMockPrismaClient } from '../mocks/prisma-mock';
import { contactRequestFixtures } from '../fixtures/data-fixtures';

describe('ContactRequestRepository', () => {
  let mockPrisma: any;
  let repo: ContactRequestRepository;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    repo = new ContactRequestRepository(mockPrisma);
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create contact request with NEW status', async () => {
      mockPrisma.contactRequest.create.mockResolvedValue(contactRequestFixtures.new);

      const result = await repo.create({
        name: 'John Doe',
        email: 'john@example.com',
        message: 'This is a test message',
      });

      expect(mockPrisma.contactRequest.create).toHaveBeenCalledWith({
        data: {
          name: 'John Doe',
          email: 'john@example.com',
          message: 'This is a test message',
          status: 'NEW',
        },
      });
      expect(result).toEqual(contactRequestFixtures.new);
    });
  });
});
