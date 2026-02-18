import { describe, expect, it, vi } from 'vitest';

import {
  getAllowedDonationRedirectOrigins,
  validateRedirectUrl,
} from '../../../src/utils/redirect-url.js';

describe('redirect-url utilities', () => {
  describe('getAllowedDonationRedirectOrigins', () => {
    it('prefers DONATION_REDIRECT_ORIGINS when provided', () => {
      const origins = getAllowedDonationRedirectOrigins({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://agrobridgefoundation.org',
        DONATION_REDIRECT_ORIGINS: 'https://safe.example.com, https://payments.example.com',
      });

      expect(origins).toEqual(['https://safe.example.com', 'https://payments.example.com']);
    });

    it('falls back to CORS_ORIGIN and adds localhost origins outside production', () => {
      const origins = getAllowedDonationRedirectOrigins({
        NODE_ENV: 'test',
        CORS_ORIGIN: 'https://agrobridgefoundation.org',
        DONATION_REDIRECT_ORIGINS: undefined,
      });

      expect(origins).toContain('https://agrobridgefoundation.org');
      expect(origins).toContain('http://localhost:3000');
      expect(origins).toContain('https://localhost:3000');
    });
  });

  describe('validateRedirectUrl', () => {
    const allowedOrigins = ['https://agrobridgefoundation.org', 'https://staging.agrobridgefoundation.org'];
    const fallback = 'https://agrobridgefoundation.org/donation/cancel';

    it('accepts allowlisted HTTPS URL and allowed path', () => {
      const result = validateRedirectUrl({
        candidateUrl: 'https://agrobridgefoundation.org/donation/success?session_id=test',
        defaultUrl: fallback,
        allowedOrigins,
        requireHttps: true,
        fieldName: 'successUrl',
        allowedPathPrefixes: ['/donation/success'],
      });

      expect(result).toBe('https://agrobridgefoundation.org/donation/success?session_id=test');
    });

    it('rejects non-allowlisted origin and falls back', () => {
      const warn = vi.fn();
      const result = validateRedirectUrl({
        candidateUrl: 'https://evil.com/phishing',
        defaultUrl: fallback,
        allowedOrigins,
        requireHttps: true,
        fieldName: 'cancelUrl',
        allowedPathPrefixes: ['/donation/cancel'],
        log: { warn },
      });

      expect(result).toBe(fallback);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('rejects HTTP URL in production mode and falls back', () => {
      const result = validateRedirectUrl({
        candidateUrl: 'http://agrobridgefoundation.org/donation/cancel',
        defaultUrl: fallback,
        allowedOrigins,
        requireHttps: true,
        fieldName: 'cancelUrl',
        allowedPathPrefixes: ['/donation/cancel'],
      });

      expect(result).toBe(fallback);
    });

    it('rejects allowlisted origin with disallowed path and falls back', () => {
      const result = validateRedirectUrl({
        candidateUrl: 'https://agrobridgefoundation.org/account/settings',
        defaultUrl: fallback,
        allowedOrigins,
        requireHttps: true,
        fieldName: 'successUrl',
        allowedPathPrefixes: ['/donation/success'],
      });

      expect(result).toBe(fallback);
    });
  });
});
