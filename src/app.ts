import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { trace, context } from '@opentelemetry/api';
import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import rawBody from 'fastify-raw-body';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import Stripe from 'stripe';
import { ZodError } from 'zod';

import { registerRoutes } from './api/routes/index.js';
import { loadEnv } from './config/env.js';
import { buildLoggerOptions } from './config/logger.js';
import { createPrismaClient } from './db/prisma.js';
import { AppError, Errors } from './errors/app-error.js';
import { fail } from './http/response.js';
import { requestContext } from './observability/request-context.js';
import { semconv } from './observability/semconv.js';
import { handleErrorWithObservability } from './middleware/error-observability.js';
import { connectRedis, disconnectRedis } from './cache/redis-client.js';
import { rateLimitMiddleware } from './rate-limiting/middleware.js';
import { configureFounderNotifier } from './observability/founder-notifier.js';

export type BuildAppOptions = {
  logger?: FastifyBaseLogger | boolean;
};

export async function buildApp(opts: BuildAppOptions = {}) {
  const env = loadEnv();

  const app = Fastify({
    logger: opts.logger ?? buildLoggerOptions(env.NODE_ENV),
    requestIdHeader: 'x-request-id',
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? crypto.randomUUID(),
    disableRequestLogging: false,
  });

  const jsonBodyLimit = 1_048_576;
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: jsonBodyLimit },
    (req, body, done) => {
      try {
        const text = typeof body === 'string' ? body.trim() : body.toString().trim();
        if (!text) return done(null, undefined);
        const parsed = JSON.parse(text);
        return done(null, parsed);
      } catch (err) {
        return done(err as Error, undefined);
      }
    },
  );

  app.decorate('env', env);

  // Founder notifications: page on critical errors if a webhook is configured.
  // No-op when FOUNDER_NOTIFY_WEBHOOK_URL is unset (dev/test).
  configureFounderNotifier(env.FOUNDER_NOTIFY_WEBHOOK_URL);

  const prisma = createPrismaClient();
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  await connectRedis(env);
  app.addHook('onClose', async () => {
    await disconnectRedis();
  });

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: env.STRIPE_API_VERSION as any,
    typescript: true,
  });
  app.decorate('stripe', stripe);

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
  });
  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'), false);
    },
    credentials: true,
  });

  app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // Disable in tests to avoid injecting surprises
    global: env.NODE_ENV !== 'test',
  });

  app.register(cookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  });

  app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'ab_admin',
      signed: true,
    },
  });

  // JWT Secret Rotation (zero-downtime): register a SECOND verifier bound to
  // the previous secret on the `previous` namespace. This decorates
  // `req.previousJwtVerify()` (reading the SAME `ab_admin` cookie) so that
  // `requireAdmin` and `/auth/refresh` can accept tokens issued before the
  // rotation. Clients naturally migrate to current-secret tokens via refresh.
  //
  // Why a namespaced instance (not a monkeypatch): in @fastify/jwt v10,
  // `req.jwtVerify()` is decorated to a closure-captured `fast-jwt` verifier
  // created at registration. It does NOT call `app.jwt.verify`, so patching
  // `app.jwt.verify` (as a prior implementation did) had no effect on request
  // verification. The namespace is the supported multi-secret mechanism.
  if (env.JWT_SECRET_PREVIOUS) {
    app.register(jwt, {
      namespace: 'previous',
      secret: env.JWT_SECRET_PREVIOUS,
      cookie: {
        cookieName: 'ab_admin',
        signed: true,
      },
    });
  }

  await app.register(rawBody, {
    field: 'rawBody',
    global: false,
    runFirst: true,
  });

  app.register(swagger, {
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

  app.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP: (header: any) => header,
    transformSpecification: (swaggerObject: any, request: any, reply: any) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });

  app.addHook('onRequest', async (req, reply) => {
    // Correlate logs with tracing.
    const span = trace.getSpan(context.active());
    const traceId = span?.spanContext().traceId;
    if (traceId) {
      req.log = req.log.child({ traceId });

      // Add consistent HTTP attributes for querying.
      span.setAttribute(semconv.ATTR_HTTP_REQUEST_METHOD, req.method);
      span.setAttribute(semconv.ATTR_URL_PATH, req.url);
    }

    // Provide request-scoped logger to lower layers.
    requestContext.run(req.log);

    if (!reply.sent) {
      await rateLimitMiddleware(req, reply);
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const span = trace.getSpan(context.active());
    if (!span) return;

    span.setAttribute(semconv.ATTR_HTTP_RESPONSE_STATUS_CODE, reply.statusCode);
    if (reply.statusCode >= 500) span.setStatus({ code: semconv.SpanStatusCode.ERROR });
  });

  // --- API Versioning & Correlation Headers ---
  // Every response includes the API version and echoes the request ID.
  // This enables contract-driven versioning: the frontend can send
  // `Accept-Version: 2026-02-01` to pin a specific API contract.
  const API_VERSION = '2026-02-17';

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-API-Version', API_VERSION);

    // Echo request ID for end-to-end correlation
    const requestId = req.id;
    if (requestId) {
      reply.header('X-Request-Id', requestId);
    }

    // Record which version the client requested (for future negotiation)
    const acceptVersion = req.headers['accept-version'];
    if (acceptVersion) {
      const span = trace.getSpan(context.active());
      span?.setAttribute('api.client_version', acceptVersion as string);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    // Use structured error observability for classification and metrics
    const classified = handleErrorWithObservability(err as Error | FastifyError, req, reply);

    // Zod validation errors - return validation details
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path, message: i.message }));
      return reply
        .status(classified.httpStatus)
        .send(fail({ code: classified.code, message: classified.message, details }));
    }

    // Our typed errors - return with full details
    if (err instanceof AppError) {
      return reply
        .status(classified.httpStatus)
        .send(fail({ code: classified.code, message: classified.message, details: err.details }));
    }

    // Fastify schema validation (AJV) lands here with statusCode
    const statusCode =
      typeof (err as { statusCode?: unknown }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 400 && statusCode < 500) {
      return reply
        .status(classified.httpStatus)
        .send(fail({ code: classified.code, message: classified.message }));
    }

    // Return classified error response
    return reply
      .status(classified.httpStatus)
      .send(fail({ code: classified.code, message: classified.message }));
  });

  registerRoutes(app);

  return app;
}
