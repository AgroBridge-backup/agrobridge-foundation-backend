import type { FastifyRequest } from 'fastify';

import { Errors } from '../errors/app-error.js';

export type AdminJwtPayload = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  iat?: number;
  exp?: number;
};

function setAdmin(req: FastifyRequest, payload: AdminJwtPayload): void {
  req.admin = { adminUserId: payload.sub, email: payload.email, role: payload.role };
}

/**
 * Verify the admin credential on the request, transparently accepting tokens
 * signed with either the current or the previous JWT secret (rotation window).
 *
 * `req.previousJwtVerify` only exists when `JWT_SECRET_PREVIOUS` is configured
 * (see app.ts); when absent, only the current secret is tried. Returns `null`
 * if neither secret verifies — callers decide how to surface that (requireAdmin
 * throws 401; /auth/refresh returns 401).
 */
export async function verifyAdminToken(
  req: FastifyRequest,
): Promise<AdminJwtPayload | null> {
  try {
    return (await req.jwtVerify()) as AdminJwtPayload;
  } catch {
    if (typeof req.previousJwtVerify === 'function') {
      try {
        return (await req.previousJwtVerify()) as AdminJwtPayload;
      } catch {
        // previous secret also rejected the token — fall through
      }
    }
    return null;
  }
}

export async function requireAdmin(req: FastifyRequest): Promise<AdminJwtPayload> {
  const payload = await verifyAdminToken(req);
  if (!payload) throw Errors.unauthorized();
  setAdmin(req, payload);
  return payload;
}

export function requireSuperAdmin(req: FastifyRequest): void {
  if (!req.admin) throw Errors.unauthorized();
  if (req.admin.role !== 'SUPER_ADMIN') throw Errors.forbidden();
}
