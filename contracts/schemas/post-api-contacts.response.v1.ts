import { z } from 'zod';

/**
 * Backward-compatible response lock for POST /api/contacts.
 * Existing required fields and types must stay compatible across versions.
 * Additive fields are allowed.
 */
export const postApiContactsResponseV1Schema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        id: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type PostApiContactsResponseV1 = z.infer<typeof postApiContactsResponseV1Schema>;
