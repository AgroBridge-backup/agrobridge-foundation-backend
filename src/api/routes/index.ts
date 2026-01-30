import type { FastifyInstance } from 'fastify';

import { adminRoutes } from './admin.js';
import { adminUserRoutes } from './admin-users.js';
import { authRoutes } from './auth.js';
import { campaignRoutes } from './campaigns.js';
import { contactRoutes } from './contacts.js';
import { donationRoutes } from './donations.js';
import { healthRoutes } from './health.js';
import { stripeWebhookRoutes } from './webhooks-stripe.js';

export function registerRoutes(app: FastifyInstance) {
  // Public routes
  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  app.register(contactRoutes, { prefix: '/api' });
  app.register(donationRoutes, { prefix: '/api' });
  app.register(campaignRoutes, { prefix: '/api' });

  // Webhook routes (signature-verified)
  app.register(stripeWebhookRoutes, { prefix: '/api' });

  // Admin routes (JWT-protected)
  app.register(adminRoutes, { prefix: '/api' });
  app.register(adminUserRoutes, { prefix: '/api' });
}
