import { z } from 'zod';

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
