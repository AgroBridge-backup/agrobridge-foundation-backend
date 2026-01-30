import { vi } from 'vitest';
import Stripe from 'stripe';

export function createMockStripe() {
  return {
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
        expire: vi.fn(),
      },
    },
    webhooks: {
      constructEvent: vi.fn(),
      signature: {
        verifyHeader: vi.fn(),
      },
    },
  } as unknown as Stripe;
}
