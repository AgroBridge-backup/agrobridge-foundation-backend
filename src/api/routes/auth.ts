import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ok } from '../../http/response.js';
import { fail } from '../../http/response.js';
import { AdminUserRepository } from '../../repositories/admin-user-repo.js';
import { AuthService } from '../../services/auth-service.js';
import { LoginRateLimiter } from '../../rate-limiting/login-rate-limiter.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

// Singleton login rate limiter (5 attempts per 15 minutes per IP)
const loginRateLimiter = new LoginRateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  blockDurationMs: 15 * 60 * 1000, // Block for 15 minutes after exceeding
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const ip = req.ip || 'unknown';

    // Check login rate limit before processing
    const rateLimitResult = loginRateLimiter.checkLimit(ip);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil(rateLimitResult.retryAfterMs / 1000);
      reply.header('Retry-After', retryAfter.toString());
      reply.status(429);
      return fail({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many login attempts. Please try again later.',
        details: {
          retryAfterSeconds: retryAfter,
          attemptsRemaining: 0,
        },
      });
    }

    const parsed = loginSchema.parse(req.body);

    const service = new AuthService(new AdminUserRepository(app.prisma));

    try {
      const admin = await service.login(parsed);

      // Reset rate limit on successful login
      loginRateLimiter.resetForIp(ip);

      const token = await reply.jwtSign(
        { sub: admin.adminUserId, email: admin.email, role: admin.role },
        { sign: { expiresIn: '24h' } },
      );

      reply
        .setCookie('ab_admin', token, {
          httpOnly: true,
          secure: app.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24,
          signed: true,
        })
        .status(200);

      return ok({});
    } catch (err) {
      // Record failed attempt (regardless of whether it's invalid credentials or other error)
      loginRateLimiter.recordFailedAttempt(ip);
      throw err;
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    // Clear the authentication cookie
    reply
      .clearCookie('ab_admin', {
        path: '/',
        httpOnly: true,
        secure: app.env.NODE_ENV === 'production',
        sameSite: 'lax',
      })
      .status(200);

    return ok({ message: 'Logged out successfully' });
  });

  app.post('/auth/refresh', async (req, reply) => {
    // Verify current token and issue a new one
    try {
      const currentPayload = await req.jwtVerify() as {
        sub: string;
        email: string;
        role: 'ADMIN' | 'SUPER_ADMIN';
      };

      // Issue new token with fresh expiration
      const token = await reply.jwtSign(
        { sub: currentPayload.sub, email: currentPayload.email, role: currentPayload.role },
        { sign: { expiresIn: '24h' } },
      );

      reply
        .setCookie('ab_admin', token, {
          httpOnly: true,
          secure: app.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24,
          signed: true,
        })
        .status(200);

      return ok({ message: 'Token refreshed successfully' });
    } catch {
      reply.status(401);
      return fail({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
  });
}
