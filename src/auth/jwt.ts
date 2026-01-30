import type { FastifyRequest } from 'fastify';

import { Errors } from '../errors/app-error.js';

export type AdminJwtPayload = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  iat?: number;
  exp?: number;
};

export async function requireAdmin(req: FastifyRequest): Promise<AdminJwtPayload> {
  try {
    const payload = (await req.jwtVerify()) as AdminJwtPayload;
    req.admin = { adminUserId: payload.sub, email: payload.email, role: payload.role };
    return payload;
  } catch {
    throw Errors.unauthorized();
  }
}

export function requireSuperAdmin(req: FastifyRequest): void {
  if (!req.admin) throw Errors.unauthorized();
  if (req.admin.role !== 'SUPER_ADMIN') throw Errors.forbidden();
}
