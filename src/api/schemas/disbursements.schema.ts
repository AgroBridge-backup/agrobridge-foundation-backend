import { z } from 'zod';

import { AppError } from '../../errors/app-error.js';

export type DisbursementMethod = 'BANK_TRANSFER' | 'MANUAL_STRIPE' | 'OTHER';
export type DisbursementStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

export const disbursementMethodSchema = z.enum([
  'BANK_TRANSFER',
  'MANUAL_STRIPE',
  'OTHER',
]);

export const disbursementStatusSchema = z.enum([
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
]);

// =============================================================================
// STATUS STATE MACHINE
// =============================================================================
//
// Single source of truth for legal status transitions. Money-out status is a
// real state machine, not a free edit: COMPLETED funds can only be REVERSED,
// never silently flipped back; REVERSED/FAILED are terminal (a retry requires a
// new Disbursement row). This prevents stale `disbursedAt` values and makes the
// audit trail meaningful. Extend this map (and only this map) to add paths.
export const ALLOWED_DISBURSEMENT_TRANSITIONS: Record<DisbursementStatus, DisbursementStatus[]> =
  {
    PENDING: ['COMPLETED', 'FAILED'],
    COMPLETED: ['REVERSED'],
    FAILED: [],
    REVERSED: [],
  };

export function isAllowedDisbursementTransition(
  from: DisbursementStatus,
  to: DisbursementStatus,
): boolean {
  return ALLOWED_DISBURSEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================================================
// MONEY-SAFETY VALIDATION (pure, throws AppError on violation)
// =============================================================================
//
// Extracted so the guards are unit-testable without a database. The route runs
// this inside the same $transaction as the create, so the guards and the write
// are atomic (no TOCTOU between "validate" and "commit").
export type DisbursableDonation = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

export function assertDisbursementLinesAreDisbursable(
  lines: Array<{ donationId: string; appliedAmount: number }>,
  donations: DisbursableDonation[],
  currency: string,
): void {
  const byId = new Map(donations.map((d) => [d.id, d]));

  for (const line of lines) {
    const donation = byId.get(line.donationId);
    if (!donation) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: `Donation ${line.donationId} not found`,
      });
    }
    if (donation.currency.toLowerCase() !== currency.toLowerCase()) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: `Donation ${line.donationId} currency (${donation.currency}) does not match disbursement currency (${currency})`,
      });
    }
    if (donation.status !== 'SUCCEEDED') {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: `Donation ${line.donationId} is not SUCCEEDED (current: ${donation.status}); only SUCCEEDED donations may be disbursed`,
      });
    }
    if (line.appliedAmount > donation.amount) {
      throw new AppError({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: `Applied amount for donation ${line.donationId} (${line.appliedAmount}) exceeds donation amount (${donation.amount})`,
      });
    }
  }
}

export const disbursementLineInputSchema = z.object({
  donationId: z.string().uuid(),
  appliedAmount: z.number().int().positive(),
});

export const createDisbursementBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('usd'),
  recipientName: z.string().trim().min(1).max(200),
  recipientIdentifier: z.string().trim().min(1).max(255),
  method: disbursementMethodSchema.default('BANK_TRANSFER'),
  externalReference: z.string().max(255).optional(),
  status: disbursementStatusSchema.default('PENDING'),
  disbursedAt: z.coerce.date().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  lines: z.array(disbursementLineInputSchema).min(1),
});

export const listDisbursementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: disbursementStatusSchema.optional(),
  method: disbursementMethodSchema.optional(),
  recipientName: z.string().optional(),
  donationId: z.string().uuid().optional(),
  sort: z
    .string()
    .default('createdAt:desc')
    .refine((v) => v === 'createdAt:desc' || v === 'createdAt:asc'),
});

export const updateDisbursementStatusBodySchema = z.object({
  status: disbursementStatusSchema,
});
