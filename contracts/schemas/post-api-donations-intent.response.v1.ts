import { z } from 'zod';

/**
 * Backward-compatible response lock for POST /api/donations/intent.
 * Existing required fields and types must stay compatible across versions.
 * Additive fields are allowed.
 */
export const postApiDonationsIntentResponseV1Schema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        sessionId: z.string().min(1),
        url: z.string().url().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export type PostApiDonationsIntentResponseV1 = z.infer<
  typeof postApiDonationsIntentResponseV1Schema
>;
