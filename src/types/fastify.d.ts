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
    /**
     * Verifier bound to the PREVIOUS JWT secret. Only present when
     * `JWT_SECRET_PREVIOUS` is configured (zero-downtime rotation window).
     * Registered as a namespaced @fastify/jwt instance in app.ts.
     */
    previousJwtVerify?: (options?: unknown) => Promise<Record<string, unknown>>;
  }
}
