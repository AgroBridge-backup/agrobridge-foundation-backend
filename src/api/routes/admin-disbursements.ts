import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireSuperAdmin } from '../../auth/jwt.js';
import { AppError } from '../../errors/app-error.js';
import { ok, fail } from '../../http/response.js';
import { DisbursementRepository } from '../../repositories/disbursement-repo.js';
import {
  assertDisbursementLinesAreDisbursable,
  createDisbursementBodySchema,
  listDisbursementsQuerySchema,
  updateDisbursementStatusBodySchema,
} from '../schemas/disbursements.schema.js';

const uuidSchema = z.string().uuid();

/**
 * Admin Disbursement Routes
 *
 * Manual money-out tracking. Disbursements record that a human transferred
 * funds to a recipient; the software never moves money itself.
 *
 * Security model:
 * - GET (list/detail): ADMIN and SUPER_ADMIN
 * - POST / PATCH (mutations): SUPER_ADMIN only
 * - Money-safety guards run before any write (donation existence, currency
 *   match, SUCCEEDED-only, appliedAmount <= donation.amount).
 */
export async function adminDisbursementRoutes(app: FastifyInstance) {
  // =========================================================================
  // LIST DISBURSEMENTS (Admin only)
  // =========================================================================
  app.get('/admin/disbursements', async (req, reply) => {
    await requireAdmin(req);

    const q = listDisbursementsQuerySchema.parse(req.query);
    const [field, direction] = q.sort.split(':') as ['createdAt', 'asc' | 'desc'];

    const repo = new DisbursementRepository(app.prisma);
    const [items, total] = await repo.listPaged({
      page: q.page,
      pageSize: q.pageSize,
      filters: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.method ? { method: q.method } : {}),
        ...(q.recipientName ? { recipientName: q.recipientName } : {}),
        ...(q.donationId ? { donationId: q.donationId } : {}),
      },
      sort: { field, direction },
    });

    const totalPages = Math.max(1, Math.ceil(total / q.pageSize));

    return ok({
      items,
      meta: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
      },
    });
  });

  // =========================================================================
  // GET SINGLE DISBURSEMENT (Admin only)
  // =========================================================================
  app.get('/admin/disbursements/:id', async (req, reply) => {
    await requireAdmin(req);

    const { id } = req.params as { id: string };
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid disbursement ID format' });
    }

    const repo = new DisbursementRepository(app.prisma);
    const disbursement = await repo.findById(id);

    if (!disbursement) {
      reply.status(404);
      return fail({ code: 'NOT_FOUND', message: 'Disbursement not found' });
    }

    return ok(disbursement);
  });

  // =========================================================================
  // CREATE DISBURSEMENT (Super Admin only)
  // =========================================================================
  app.post('/admin/disbursements', async (req, reply) => {
    const payload = await requireAdmin(req);
    requireSuperAdmin(req);

    const bodyResult = createDisbursementBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      reply.status(400);
      return fail({
        code: 'VALIDATION_ERROR',
        message: 'Invalid disbursement body',
        details: bodyResult.error.flatten(),
      });
    }
    const body = bodyResult.data;

    const donationIds = body.lines.map((line) => line.donationId);

    // Reject duplicate donationIds up front (the unique constraint on
    // DisbursementLine.donationId would otherwise reject at write time).
    if (donationIds.length !== new Set(donationIds).size) {
      reply.status(400);
      return fail({
        code: 'VALIDATION_ERROR',
        message: 'Duplicate donationId in lines; a donation may only be disbursed once',
      });
    }

    // NOTE: amount is intentionally NOT constrained to sum(appliedAmount) —
    // the real transfer may include fees/top-ups. See schema rationale.

    // If status is COMPLETED and no disbursedAt supplied, stamp now.
    const disbursedAt =
      body.status === 'COMPLETED' ? (body.disbursedAt ?? new Date()) : body.disbursedAt;

    const repo = new DisbursementRepository(app.prisma);

    // Atomic money-safety: validation + create run in ONE transaction so a
    // donation cannot be soft-deleted, status-flipped, or already-disbursed
    // between the read and the write (TOCTOU). AppErrors thrown inside the
    // callback roll back the transaction and surface via the global error
    // handler with the correct status (400 / 409).
    const created = await app.prisma.$transaction(async (tx) => {
      // deletedAt: null guards against disbursing a soft-deleted donation.
      const donations = await tx.donation.findMany({
        where: { id: { in: donationIds }, deletedAt: null },
        select: { id: true, amount: true, currency: true, status: true },
      });
      if (donations.length !== donationIds.length) {
        throw new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'One or more donationIds do not exist or have been deleted',
        });
      }

      assertDisbursementLinesAreDisbursable(body.lines, donations, body.currency);

      return repo.create(
        {
          amount: body.amount,
          currency: body.currency,
          recipientName: body.recipientName,
          recipientIdentifier: body.recipientIdentifier,
          method: body.method,
          status: body.status,
          createdBy: payload.sub,
          ...(body.externalReference ? { externalReference: body.externalReference } : {}),
          ...(disbursedAt ? { disbursedAt } : {}),
          ...(body.notes ? { notes: body.notes } : {}),
          ...(body.metadata ? { metadata: body.metadata } : {}),
          lines: body.lines,
        },
        tx,
      );
    });

    reply.status(201);
    return ok(created);
  });

  // =========================================================================
  // UPDATE DISBURSEMENT STATUS (Super Admin only)
  //
  // The state machine (legal transitions), disbursedAt bookkeeping, and the
  // append-only statusHistory audit trail all live in
  // DisbursementRepository.updateStatus, which runs them atomically in a single
  // transaction. `by` is the super-admin's id from the JWT, recorded on every
  // transition. Illegal transitions throw a 409 CONFLICT.
  // =========================================================================
  app.patch('/admin/disbursements/:id/status', async (req, reply) => {
    const payload = await requireAdmin(req);
    requireSuperAdmin(req);

    const { id } = req.params as { id: string };
    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      reply.status(400);
      return fail({ code: 'VALIDATION_ERROR', message: 'Invalid disbursement ID format' });
    }

    const bodyResult = updateDisbursementStatusBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      reply.status(400);
      return fail({
        code: 'VALIDATION_ERROR',
        message: 'Invalid status body',
        details: bodyResult.error.flatten(),
      });
    }

    const repo = new DisbursementRepository(app.prisma);
    const updated = await repo.updateStatus(id, bodyResult.data.status, { by: payload.sub });

    return ok(updated);
  });
}
