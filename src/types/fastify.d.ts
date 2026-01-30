import type { PrismaClient } from '@prisma/client';
import type { Stripe } from 'stripe';
import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    prisma: PrismaClient;
    stripe: Stripe;
  }

  interface FastifyRequest {
    rawBody?: Buffer;
    admin?: {
      adminUserId: string;
      email: string;
      role: 'ADMIN' | 'SUPER_ADMIN';
    };
  }
}
