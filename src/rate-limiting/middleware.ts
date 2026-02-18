import { FastifyRequest, FastifyReply } from 'fastify';
import { getTieredRateLimiter } from './tiered-rate-limiter.js';
import { AbuseDetector } from './abuse-detection.js';
import { RateLimitTier } from './tier-config.js';
import { trace } from '@opentelemetry/api';

export async function rateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const limiter = getTieredRateLimiter();
  const abuseDetector = new AbuseDetector();

  const abuseScore = await abuseDetector.detectAbuse(req);
  if (abuseScore.isAbusive) {
    const tracer = trace.getTracer('agrobridge.ratelimit');
    tracer.startActiveSpan('rate_limit.abuse_block', (span) => {
      span.setAttribute('rate_limit.abuse_score', abuseScore.score);
      span.setAttribute('rate_limit.abuse_reasons', abuseScore.reasons.join(', '));
      span.end();
    });

    reply.status(429).send({
      ok: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        details: {
          tier: RateLimitTier.ABUSE,
          retryAfter: 60,
        },
      },
    });
    return;
  }

  const limitInfo = await limiter.checkRequest(req, reply);
  if (!limitInfo.allowed) {
    const retryAfter = Math.ceil((limitInfo.resetTime.getTime() - Date.now()) / 1000);

    reply.header('X-RateLimit-Limit', limitInfo.limit.toString());
    reply.header('X-RateLimit-Remaining', limitInfo.remaining.toString());
    reply.header('X-RateLimit-Reset', Math.floor(limitInfo.resetTime.getTime() / 1000).toString());
    reply.header('Retry-After', retryAfter.toString());

    reply.status(429).send({
      ok: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please try again later.',
        details: {
          tier: limitInfo.tier,
          limit: limitInfo.limit,
          retryAfter,
        },
      },
    });
    return;
  }

  reply.header('X-RateLimit-Limit', limitInfo.limit.toString());
  reply.header('X-RateLimit-Remaining', limitInfo.remaining.toString());
  reply.header('X-RateLimit-Reset', Math.floor(limitInfo.resetTime.getTime() / 1000).toString());
}
