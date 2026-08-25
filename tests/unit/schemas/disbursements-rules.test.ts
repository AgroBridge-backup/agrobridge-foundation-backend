import { describe, expect, it } from 'vitest';

import { AppError } from '../../../src/errors/app-error.js';
import {
  ALLOWED_DISBURSEMENT_TRANSITIONS,
  assertDisbursementLinesAreDisbursable,
  isAllowedDisbursementTransition,
} from '../../../src/api/schemas/disbursements.schema.js';

describe('disbursement domain rules', () => {
  describe('isAllowedDisbursementTransition (status state machine)', () => {
    it('allows the legal money-out paths', () => {
      expect(isAllowedDisbursementTransition('PENDING', 'COMPLETED')).toBe(true);
      expect(isAllowedDisbursementTransition('PENDING', 'FAILED')).toBe(true);
      expect(isAllowedDisbursementTransition('COMPLETED', 'REVERSED')).toBe(true);
    });

    it('rejects REVERSED -> COMPLETED (terminal state)', () => {
      expect(isAllowedDisbursementTransition('REVERSED', 'COMPLETED')).toBe(false);
    });

    it('rejects a no-op (same status) so disbursedAt can never be re-stamped', () => {
      expect(isAllowedDisbursementTransition('COMPLETED', 'COMPLETED')).toBe(false);
      expect(isAllowedDisbursementTransition('PENDING', 'PENDING')).toBe(false);
    });

    it('treats FAILED and REVERSED as terminal (a retry needs a new Disbursement)', () => {
      expect(ALLOWED_DISBURSEMENT_TRANSITIONS.FAILED).toEqual([]);
      expect(ALLOWED_DISBURSEMENT_TRANSITIONS.REVERSED).toEqual([]);
      expect(isAllowedDisbursementTransition('FAILED', 'COMPLETED')).toBe(false);
      expect(isAllowedDisbursementTransition('FAILED', 'PENDING')).toBe(false);
    });

    it('rejects COMPLETED -> PENDING (funds cannot be un-completed, only reversed)', () => {
      expect(isAllowedDisbursementTransition('COMPLETED', 'PENDING')).toBe(false);
    });
  });

  describe('assertDisbursementLinesAreDisbursable (money-safety guards)', () => {
    const disbursable = (overrides: Partial<{ id: string; amount: number; currency: string; status: string }> = {}) => ({
      id: '11111111-1111-1111-1111-111111111111',
      amount: 5000,
      currency: 'usd',
      status: 'SUCCEEDED',
      ...overrides,
    });

    it('accepts SUCCEEDED donations within amount', () => {
      expect(() =>
        assertDisbursementLinesAreDisbursable(
          [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5000 }],
          [disbursable()],
          'usd',
        ),
      ).not.toThrow();
    });

    it('rejects a non-SUCCEEDED donation (money-out requires a captured payment)', () => {
      try {
        assertDisbursementLinesAreDisbursable(
          [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5000 }],
          [disbursable({ status: 'PENDING' })],
          'usd',
        );
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('VALIDATION_ERROR');
        expect((err as AppError).message).toMatch(/not SUCCEEDED/);
      }
    });

    it('rejects a currency mismatch', () => {
      expect(() =>
        assertDisbursementLinesAreDisbursable(
          [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 100 }],
          [disbursable({ currency: 'eur' })],
          'usd',
        ),
      ).toThrow(AppError);
    });

    it('rejects appliedAmount exceeding the donation amount', () => {
      expect(() =>
        assertDisbursementLinesAreDisbursable(
          [{ donationId: '11111111-1111-1111-1111-111111111111', appliedAmount: 5001 }],
          [disbursable({ amount: 5000 })],
          'usd',
        ),
      ).toThrow(AppError);
    });

    it('rejects when a linked donation is missing (defensive: route also checks counts)', () => {
      expect(() =>
        assertDisbursementLinesAreDisbursable(
          [{ donationId: '22222222-2222-2222-2222-222222222222', appliedAmount: 100 }],
          [disbursable()],
          'usd',
        ),
      ).toThrow(AppError);
    });
  });
});
