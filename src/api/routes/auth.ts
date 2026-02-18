import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ok } from '../../http/response.js';
import { fail } from '../../http/response.js';
import { AdminUserRepository } from '../../repositories/admin-user-repo.js';
import { AuthService } from '../../services/auth-service.js';
import { LoginRateLimiter } from '../../rate-limiting/login-rate-limiter.js';
import { AbuseDetector } from '../../rate-limiting/abuse-detection.js';
import { getRedisClient } from '../../cache/redis-client.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

let loginRateLimiter: LoginRateLimiter | null = null;
const abuseDetector = new AbuseDetector();

function isAccountLocked(lockedUntil: Date | null | undefined): lockedUntil is Date {
  return Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
}

function isUnauthorizedError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'UNAUTHORIZED'
  );
}

function getLoginRateLimiter(app: FastifyInstance): LoginRateLimiter {
  if (!loginRateLimiter) {
    let redis;
    try {
      redis = getRedisClient(app.env);
    } catch {
      // Redis may not be available (e.g. in tests); fall back to in-memory
    }
    loginRateLimiter = new LoginRateLimiter(
      {
        maxAttempts: 5,
        windowMs: 15 * 60 * 1000,
        blockDurationMs: 15 * 60 * 1000,
      },
      redis,
    );
  }
  return loginRateLimiter;
}

export async function authRoutes(app: FastifyInstance) {
  // Start periodic cleanup for in-memory abuse store
  abuseDetector.startCleanup();

  // Tear down on app close
  app.addHook('onClose', async () => {
    abuseDetector.stopCleanup();
    if (loginRateLimiter) {
      loginRateLimiter.destroy();
      loginRateLimiter = null;
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const ip = req.ip || 'unknown';
    const parsed = loginSchema.parse(req.body);
    const service = new AuthService(new AdminUserRepository(app.prisma));
    const admin = await service.findByEmail(parsed.email);

    if (isAccountLocked(admin?.lockedUntil)) {
      const retryAfter = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 1000);
      reply.header('Retry-After', retryAfter.toString());
      reply.status(429);
      return fail({
        code: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked due to failed login attempts.',
        details: { retryAfterSeconds: retryAfter },
      });
    }

    // SECURITY FIX: Use atomic checkAndRecord() instead of deprecated checkLimit()
    // This prevents TOCTOU race conditions where concurrent requests could
    // bypass the rate limit between check and record operations.
    const limiter = getLoginRateLimiter(app);
    const rateLimitResult = await limiter.checkAndRecord(ip, false);
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

    try {
      const loggedInAdmin = await service.login(parsed);

      // Reset rate limit on successful login
      await limiter.resetForIp(ip);
      abuseDetector.recordSuccessfulLogin(ip);
      await service.resetFailedAttempts(loggedInAdmin.adminUserId);

      const token = await reply.jwtSign(
        { sub: loggedInAdmin.adminUserId, email: loggedInAdmin.email, role: loggedInAdmin.role },
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
      // SECURITY FIX: Atomically record failed attempt via checkAndRecord(ip, true)
      // instead of separate recordFailedAttempt() which had TOCTOU vulnerability
      await limiter.checkAndRecord(ip, true);

      if (isUnauthorizedError(err)) {
        abuseDetector.recordFailedLogin(ip);

        if (admin && !admin.deletedAt) {
          const lockState = await service.recordFailedAttempt(admin.id);
          if (isAccountLocked(lockState.lockedUntil)) {
            const retryAfter = Math.ceil((lockState.lockedUntil.getTime() - Date.now()) / 1000);
            reply.header('Retry-After', retryAfter.toString());
            reply.status(429);
            return fail({
              code: 'ACCOUNT_LOCKED',
              message: 'Account is temporarily locked due to failed login attempts.',
              details: { retryAfterSeconds: retryAfter },
            });
          }
        }
      }

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

      // SECURITY FIX: Verify user is not deleted or locked before refreshing.
      // Previously, deleted/locked admins could refresh tokens indefinitely.
      const repo = new AdminUserRepository(app.prisma);
      const user = await repo.findById(currentPayload.sub);

      if (!user || user.deletedAt) {
        reply.status(401);
        return fail({ code: 'UNAUTHORIZED', message: 'Account no longer active' });
      }

      if (isAccountLocked(user.lockedUntil)) {
        reply.status(403);
        return fail({ code: 'ACCOUNT_LOCKED', message: 'Account is locked' });
      }

      // Issue new token with fresh expiration using current DB state
      const token = await reply.jwtSign(
        { sub: user.id, email: user.email, role: user.role },
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
