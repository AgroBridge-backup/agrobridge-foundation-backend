import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import type { Stripe } from 'stripe';

import type { Env } from '../../src/config/env.js';
import { registerRoutes } from '../../src/api/routes/index.js';

const CONTRACT_ENV: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
  JWT_SECRET: 'x'.repeat(32),
  COOKIE_SECRET: 'y'.repeat(16),
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_API_VERSION: '2024-06-20',
  CORS_ORIGIN: 'https://example.com,https://secondary.example.com',
  REDIS_URL: 'redis://localhost:6379',
};

export function createContractApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('env', CONTRACT_ENV);
  app.decorate('prisma', {} as PrismaClient);
  app.decorate('stripe', {} as Stripe);
  return app;
}

export async function createContractRouteApp(
  plugin: FastifyPluginAsync,
  prefix = '/api',
): Promise<FastifyInstance> {
  const app = createContractApp();
  await app.register(plugin, { prefix });
  await app.ready();
  return app;
}

export async function generateOpenApiDocument(): Promise<Record<string, unknown>> {
  const app = createContractApp();
  try {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Agrobridge Foundation API',
          description: 'Backend API for Agrobridge Foundation',
          version: '0.1.0',
        },
        servers: [
          {
            url: 'http://localhost:3000',
            description: 'Development server',
          },
        ],
      },
    });

    registerRoutes(app);
    await app.ready();

    return sortJson(app.swagger() as Record<string, unknown>);
  } finally {
    await app.close();
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortJson(entry)]));
  }

  return value;
}
