import { Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';

import { classifyError, type ErrorContext } from '../../../src/middleware/error-observability.js';

/**
 * Regression tests for Prisma error classification.
 *
 * Guard against the P2025 misclassification: a prior duplicate `if (code ===
 * 'P2025')` branch in classifyPrismaError mapped not-found errors to
 * INFRA_DB_POOL_EXHAUSTED / 503, shadowing the correct CLIENT_NOT_FOUND / 404
 * branch. That made legitimate 404s surface (and alert) as infrastructure 503s.
 */
const ctx: ErrorContext = {
  requestId: 'req-1',
  endpoint: '/api/admin/x',
  method: 'GET',
  userId: undefined,
  userType: 'anonymous',
  ip: undefined,
  userAgent: undefined,
  timestamp: new Date(),
  latencyMs: 0,
};

function prismaKnownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`${code} failure`, {
    code,
    clientVersion: '7.2.0',
  });
}

describe('classifyError — Prisma code mapping', () => {
  test('P2025 (not found) maps to CLIENT_NOT_FOUND / 404, NOT pool-exhausted / 503', () => {
    const c = classifyError(prismaKnownError('P2025'), ctx);
    expect(c.code).toBe('CLIENT_NOT_FOUND');
    expect(c.httpStatus).toBe(404);
    expect(c.category).toBe('CLIENT');
    expect(c.severity).toBe('info');
    // Explicitly guard the regression: must NOT be the old mapping.
    expect(c.code).not.toBe('INFRA_DB_POOL_EXHAUSTED');
    expect(c.httpStatus).not.toBe(503);
  });

  test('P2024 (pool/transaction timeout) maps to INFRA_DB_TIMEOUT / 504', () => {
    const c = classifyError(prismaKnownError('P2024'), ctx);
    expect(c.code).toBe('INFRA_DB_TIMEOUT');
    expect(c.httpStatus).toBe(504);
    expect(c.category).toBe('INFRASTRUCTURE');
  });

  test('P2002 (unique constraint) maps to a 409 business-logic conflict', () => {
    const c = classifyError(prismaKnownError('P2002'), ctx);
    expect(c.code).toBe('APP_BUSINESS_LOGIC');
    expect(c.httpStatus).toBe(409);
  });

  test('P2003 (foreign key) maps to 422 business-logic', () => {
    const c = classifyError(prismaKnownError('P2003'), ctx);
    expect(c.code).toBe('APP_BUSINESS_LOGIC');
    expect(c.httpStatus).toBe(422);
  });

  test('P10xx (connection) maps to a 503 infrastructure error', () => {
    const c = classifyError(prismaKnownError('P1001'), ctx);
    expect(c.category).toBe('INFRASTRUCTURE');
    expect(c.httpStatus).toBe(503);
  });
});
