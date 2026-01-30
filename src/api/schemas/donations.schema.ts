import { z } from 'zod';

export type DonationStatus = 'PENDING' | 'SUCCEEDED' | 'EXPIRED' | 'REFUNDED';
export type DonationType = 'ONE_TIME' | 'RECURRING';

export const createDonationIntentRequestBodySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3).default('usd'),
  donorEmail: z.string().email().max(254).optional(),
  donorName: z.string().trim().min(1).max(200).optional(),
  isAnonymous: z.boolean().default(false),
  message: z.string().trim().max(500).optional(), // Donor dedication message
  campaignId: z.string().uuid().optional(), // Associate with a campaign
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const createDonationIntentResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    donationId: z.string().uuid(),
    amount: z.number(),
    currency: z.string(),
    donorEmail: z.string().email().nullable(),
    stripeSessionId: z.string(),
    stripeCheckoutUrl: z.string().url(),
  }),
});

export const createDonationIntentRouteSchema = {
  summary: 'Create Donation Intent',
  description: 'Create a Stripe Checkout session for a donation',
  tags: ['Donations'],
  body: createDonationIntentRequestBodySchema,
  response: {
    200: createDonationIntentResponseSchema,
    422: z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.literal('VALIDATION_ERROR'),
        message: z.string(),
        details: z.array(
          z.object({
            path: z.array(z.string()),
            message: z.string(),
          }),
        ),
      }),
    }),
  },
};
