export const donationFixtures = {
  pending: {
    id: '123e4567-e89b-12d3-a456-426614174000',
    amount: 5000,
    currency: 'usd',
    status: 'PENDING' as const,
    donorEmail: 'donor@example.com',
    metadata: { campaign: 'mvp' },
    stripeSessionId: 'cs_123',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
  succeeded: {
    id: '123e4567-e89b-12d3-a456-426614174001',
    amount: 10000,
    currency: 'usd',
    status: 'SUCCEEDED' as const,
    donorEmail: 'donor2@example.com',
    metadata: { campaign: 'fundraiser' },
    stripeSessionId: 'cs_456',
    createdAt: new Date('2024-01-02T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  },
  expired: {
    id: '123e4567-e89b-12d3-a456-426614174002',
    amount: 2500,
    currency: 'usd',
    status: 'EXPIRED' as const,
    donorEmail: null,
    metadata: null,
    stripeSessionId: 'cs_789',
    createdAt: new Date('2024-01-03T00:00:00Z'),
    updatedAt: new Date('2024-01-03T00:00:00Z'),
  },
};

export const adminUserFixtures = {
  admin: {
    id: 'admin-123',
    email: 'admin@agrobridge.org',
    passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
    lastLoginAt: new Date('2024-01-01T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
};

export const contactRequestFixtures = {
  new: {
    id: 'contact-123',
    name: 'John Doe',
    email: 'john@example.com',
    message: 'This is a test message',
    status: 'NEW' as const,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
};

export const webhookEventFixtures = {
  processed: {
    id: 'webhook-123',
    eventId: 'evt_test_123',
    type: 'checkout.session.completed',
    rawPayload: '{"id":"evt_test_123","type":"checkout.session.completed"}',
    processed: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  },
  unprocessed: {
    id: 'webhook-456',
    eventId: 'evt_test_456',
    type: 'checkout.session.expired',
    rawPayload: '{"id":"evt_test_456","type":"checkout.session.expired"}',
    processed: false,
    createdAt: new Date('2024-01-02T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  },
};
