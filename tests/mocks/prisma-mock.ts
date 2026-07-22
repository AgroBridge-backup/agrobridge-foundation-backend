import { vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

export function createMockPrismaClient() {
  return {
    donation: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    adminUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contactRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    webhookEvent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}
