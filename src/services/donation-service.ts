import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import { Errors } from '../errors/app-error.js';
import { DonationRepository } from '../repositories/donation-repo.js';

const intentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().trim().toLowerCase().length(3).default('usd'),
  donorEmail: z.string().trim().email().max(254).optional(),
  donorName: z.string().trim().min(1).max(200).optional(),
  isAnonymous: z.boolean().default(false),
  message: z.string().trim().max(500).optional(),
  campaignId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export class DonationService {
  constructor(private readonly donations: DonationRepository) {}

  async createDonationIntent(input: unknown) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('donations.create_intent', async (span) => {
      try {
        const parsed = intentSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        span.setAttribute('donation.amount', parsed.data.amount);
        span.setAttribute('donation.currency', parsed.data.currency);
        span.setAttribute('donation.has_donor_email', Boolean(parsed.data.donorEmail));
        span.setAttribute('donation.has_campaign', Boolean(parsed.data.campaignId));
        span.setAttribute('donation.is_anonymous', parsed.data.isAnonymous);

        // amount is minor units (e.g., cents)
        const createPayload: Parameters<typeof this.donations.createPending>[0] = {
          amount: parsed.data.amount,
          currency: parsed.data.currency,
          isAnonymous: parsed.data.isAnonymous,
        };

        if (parsed.data.donorEmail) createPayload.donorEmail = parsed.data.donorEmail;
        if (parsed.data.donorName) createPayload.donorName = parsed.data.donorName;
        if (parsed.data.message) createPayload.message = parsed.data.message;
        if (parsed.data.campaignId) createPayload.campaignId = parsed.data.campaignId;
        if (parsed.data.metadata) createPayload.metadata = parsed.data.metadata as any;

        const donation = await this.donations.createPending(createPayload);

        span.setAttribute('donation.id', donation.id);

        return {
          donationId: donation.id,
          amount: parsed.data.amount,
          currency: parsed.data.currency,
          donorEmail: parsed.data.donorEmail,
          donorName: parsed.data.donorName,
          isAnonymous: parsed.data.isAnonymous,
          message: parsed.data.message,
          campaignId: parsed.data.campaignId,
          metadata: parsed.data.metadata,
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
