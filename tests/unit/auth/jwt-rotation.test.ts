import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { requireAdmin } from '../../../src/auth/jwt.js';

/**
 * JWT secret-rotation tests.
 *
 * These exercise the REAL @fastify/jwt machinery (not mocks) via a minimal
 * Fastify app — no Prisma/Redis — proving that:
 *   1. tokens signed with the CURRENT secret verify,
 *   2. during rotation, tokens signed with the PREVIOUS secret also verify,
 *   3. garbage tokens are rejected,
 *   4. without a rotation instance, previous-secret tokens are rejected.
 *
 * Background: the prior implementation monkeypatched `app.jwt.verify`, which
 * `req.jwtVerify()` never calls — so rotation silently did nothing. These tests
 * guard against that regression by asserting end-to-end behavior.
 */

const CURRENT_SECRET = 'current-signing-secret-min-32-chars!!!';
const PREVIOUS_SECRET = 'previous-signing-secret-min-32-chars!';
const COOKIE_SECRET = 'cookie-signing-secret-16';

const PAYLOAD = { sub: 'u-1', email: 'admin@agrobridge.org', role: 'ADMIN' as const };

function buildApp(withRotation: boolean): FastifyInstance {
  const app = Fastify();
  app.register(cookie, { secret: COOKIE_SECRET });
  app.register(jwt, {
    secret: CURRENT_SECRET,
    cookie: { cookieName: 'ab_admin', signed: true },
  });
  if (withRotation) {
    app.register(jwt, {
      namespace: 'previous',
      secret: PREVIOUS_SECRET,
      cookie: { cookieName: 'ab_admin', signed: true },
    });
  }
  app.get('/guarded', async (req, reply) => {
    try {
      await requireAdmin(req);
      return { ok: true, admin: req.admin };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode ?? 500;
      return reply.code(status).send({ ok: false });
    }
  });
  return app;
}

/** Sign a token with an arbitrary secret using a throwaway jwt instance. */
async function signWithSecret(secret: string, payload: Record<string, unknown>): Promise<string> {
  const signer = Fastify();
  signer.register(jwt, { secret });
  await signer.ready();
  const token = signer.jwt.sign(payload);
  await signer.close();
  return token;
}

async function bearer(token: string, app: FastifyInstance) {
  return app.inject({
    method: 'GET',
    url: '/guarded',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('JWT secret rotation — rotation window active', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(true);
    await app.ready();
  });
  afterAll(async () => app.close());

  test('current-secret token is accepted', async () => {
    const token = app.jwt.sign(PAYLOAD);
    const res = await bearer(token, app);
    expect(res.statusCode).toBe(200);
    expect(res.json().admin.adminUserId).toBe('u-1');
  });

  test('previous-secret token is accepted (rotation)', async () => {
    const token = await signWithSecret(PREVIOUS_SECRET, PAYLOAD);
    const res = await bearer(token, app);
    expect(res.statusCode).toBe(200);
    expect(res.json().admin.role).toBe('ADMIN');
  });

  test('garbage token is rejected with 401', async () => {
    const res = await bearer('not-a-real-jwt', app);
    expect(res.statusCode).toBe(401);
  });

  test('token signed by a THIRD/unknown secret is rejected', async () => {
    const token = await signWithSecret('some-other-secret-min-32-chars-ok!!!', PAYLOAD);
    const res = await bearer(token, app);
    expect(res.statusCode).toBe(401);
  });
});

describe('JWT secret rotation — no rotation configured', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp(false);
    await app.ready();
  });
  afterAll(async () => app.close());

  test('current-secret token is accepted', async () => {
    const token = app.jwt.sign(PAYLOAD);
    const res = await bearer(token, app);
    expect(res.statusCode).toBe(200);
  });

  test('previous-secret token is rejected (no fallback verifier)', async () => {
    const token = await signWithSecret(PREVIOUS_SECRET, PAYLOAD);
    const res = await bearer(token, app);
    expect(res.statusCode).toBe(401);
  });

  test('missing token is rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    expect(res.statusCode).toBe(401);
  });
});
