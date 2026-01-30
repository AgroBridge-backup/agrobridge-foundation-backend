import type { PrismaClient } from '@prisma/client';
import type { DonationStatus } from '@prisma/client';

export async function seedDonations(count: number, options: { status?: DonationStatus } = {}) {
  const donations = Array.from({ length: count }, (_, i) => ({
    id: `donation-${i}-${Date.now()}`,
    amount: 1000 + (i % 10) * 1000,
    currency: 'usd',
    status: options.status || (['PENDING', 'SUCCEEDED', 'EXPIRED'] as DonationStatus[])[i % 3],
    donorEmail: `donor${i}@example.com`,
    stripeSessionId: `cs_test_${i}`,
    metadata: { campaign: 'test' },
    createdAt: new Date(Date.now() - (count - i) * 1000),
    updatedAt: new Date(Date.now() - (count - i) * 1000),
  }));

  return donations;
}

export async function seedContactRequests(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `contact-${i}-${Date.now()}`,
    name: `Contact ${i}`,
    email: `contact${i}@example.com`,
    message: `Test message ${i}`,
    status: 'NEW' as const,
    createdAt: new Date(Date.now() - (count - i) * 1000),
    updatedAt: new Date(Date.now() - (count - i) * 1000),
  }));
}

export async function seedAdminUsers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `admin-${i}-${Date.now()}`,
    email: `admin${i}@agrobridge.org`,
    passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
    role: i === 0 ? 'SUPER_ADMIN' : ('ADMIN' as const),
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

export async function seedWebhookEvents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt_test_${i}`,
    type: i % 2 === 0 ? 'checkout.session.completed' : 'checkout.session.expired',
    rawPayload: JSON.stringify({
      id: `evt_test_${i}`,
      type: i % 2 === 0 ? 'checkout.session.completed' : 'checkout.session.expired',
      data: { test: true },
    }),
    processed: i % 2 === 0,
    createdAt: new Date(Date.now() - (count - i) * 1000),
    updatedAt: new Date(Date.now() - (count - i) * 1000),
  }));
}
