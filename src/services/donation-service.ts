import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { Errors } from '../errors/app-error.js';
import { DonationRepository } from '../repositories/donation-repo.js';

const frequencySchema = z.enum(['one-time', 'monthly']).default('one-time');

const intentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().trim().toLowerCase().length(3).default('usd'),
  // Accept both `donorEmail` (native) and `email` (frontend alias)
  donorEmail: z.string().trim().email().max(254).optional(),
  email: z.string().trim().email().max(254).optional(),
  donorName: z.string().trim().min(1).max(200).optional(),
  isAnonymous: z.boolean().default(false),
  message: z.string().trim().max(500).optional(),
  campaignId: z.string().uuid().optional(),
  frequency: frequencySchema,
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  source: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).transform((data) => {
  // Merge `email` into `donorEmail` (donorEmail takes precedence)
  const donorEmail = data.donorEmail ?? data.email;
  // Map frequency to donation type
  const type: 'ONE_TIME' | 'RECURRING' = data.frequency === 'monthly' ? 'RECURRING' : 'ONE_TIME';
  return { ...data, donorEmail, type };
});

export class DonationService {
  constructor(private readonly donations: DonationRepository) {}

  async createDonationIntent(input: unknown) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('donations.create_intent', async (span) => {
      try {
        const parsed = intentSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        const { donorEmail, type, amount, currency, isAnonymous, donorName, message, campaignId, metadata, frequency, successUrl, cancelUrl, source } = parsed.data;

        span.setAttribute('donation.amount', amount);
        span.setAttribute('donation.currency', currency);
        span.setAttribute('donation.has_donor_email', Boolean(donorEmail));
        span.setAttribute('donation.has_campaign', Boolean(campaignId));
        span.setAttribute('donation.is_anonymous', isAnonymous);
        span.setAttribute('donation.type', type);

        // amount is minor units (e.g., cents)
        const createPayload: Parameters<typeof this.donations.createPending>[0] = {
          amount,
          currency,
          isAnonymous,
          // Persist the donation type so recurring vs one-time is queryable.
          // Previously `type` was computed and traced but never written, so every
          // donation (including monthly) was stored as ONE_TIME.
          type,
        };

        if (donorEmail) createPayload.donorEmail = donorEmail;
        if (donorName) createPayload.donorName = donorName;
        if (message) createPayload.message = message;
        if (campaignId) createPayload.campaignId = campaignId;
        if (metadata) createPayload.metadata = metadata as any;

        const donation = await this.donations.createPending(createPayload);

        span.setAttribute('donation.id', donation.id);

        return {
          donationId: donation.id,
          amount,
          currency,
          donorEmail,
          donorName,
          isAnonymous,
          message,
          campaignId,
          metadata,
          frequency,
          type,
          successUrl,
          cancelUrl,
          source,
        };
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
