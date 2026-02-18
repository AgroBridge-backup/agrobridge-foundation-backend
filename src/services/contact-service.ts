import { z } from 'zod';
import { trace } from '@opentelemetry/api';

import { Errors } from '../errors/app-error.js';
import { ContactRequestRepository } from '../repositories/contact-request-repo.js';
import {
  sanitizeContactForm,
  detectXssPatterns,
} from '../lib/xss-sanitizer.js';

/**
 * Contact form schema with honeypot anti-spam protection
 * and XSS prevention.
 *
 * Honeypot strategy:
 * - `website` field should be empty (hidden via CSS on frontend)
 * - `timestamp` field should be within reasonable bounds (not too fast)
 * - Bots typically fill all fields and submit instantly
 *
 * XSS Prevention strategy:
 * - All user input is sanitized using DOMPurify before storage
 * - HTML tags are completely stripped from messages
 * - Email addresses are validated and sanitized
 * - XSS attack attempts are logged for security monitoring
 *
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Critical - XSS sanitization is enforced at service layer
 */
const contactSchema = z.object({
  name: z.string().trim().min(1).max(140),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(1).max(5000),
  // Source tracking from frontend
  source: z.string().max(100).optional(),
  page: z.string().max(500).optional(),
  // Honeypot fields - should be empty/valid for real users
  website: z.string().max(0).optional().default(''), // Must be empty
  _gotcha: z.string().max(0).optional().default(''), // Alternative honeypot
  _timestamp: z.coerce.number().optional(), // Form render timestamp
});

// Minimum time (ms) between form render and submit (bots submit instantly)
const MIN_SUBMISSION_TIME_MS = 3000; // 3 seconds
// Maximum time (ms) for form submission (prevent replay attacks)
const MAX_SUBMISSION_TIME_MS = 30 * 60 * 1000; // 30 minutes

export class ContactService {
  constructor(private readonly contacts: ContactRequestRepository) {}

  async create(input: unknown) {
    const tracer = trace.getTracer('agrobridge.services');

    return tracer.startActiveSpan('contact.create', async (span) => {
      try {
        const parsed = contactSchema.safeParse(input);
        if (!parsed.success) throw Errors.validation(parsed.error.flatten());

        const { name, email, message, source, page, website, _gotcha, _timestamp } = parsed.data;

        // Honeypot check: these fields should be empty
        const isHoneypotTriggered = website.length > 0 || _gotcha.length > 0;

        // Timing check: form should not be submitted too quickly or too slowly
        let isTimingInvalid = false;
        if (_timestamp) {
          const now = Date.now();
          const submissionTime = now - _timestamp;
          isTimingInvalid =
            submissionTime < MIN_SUBMISSION_TIME_MS || submissionTime > MAX_SUBMISSION_TIME_MS;

          span.setAttribute('contact.submission_time_ms', submissionTime);
        }

        // If spam detected, log it but return success (don't reveal detection)
        if (isHoneypotTriggered || isTimingInvalid) {
          span.setAttribute('contact.spam_detected', true);
          span.setAttribute('contact.honeypot_triggered', isHoneypotTriggered);
          span.setAttribute('contact.timing_invalid', isTimingInvalid);

          // Silently reject - return fake success to fool bots
          span.end();
          return { id: crypto.randomUUID(), _spam: true };
        }

        span.setAttribute('contact.spam_detected', false);

        // XSS SANITIZATION: Sanitize all user input before storage
        const sanitized = sanitizeContactForm({ 
          name, 
          email, 
          message, 
          source: source ?? '', 
          page: page ?? '' 
        });

        // Log XSS detection for security monitoring
        if (sanitized.xssDetected) {
          span.setAttribute('security.xss_detected', true);
          span.setAttribute('security.xss_patterns', sanitized.patterns.join(','));
          
          // Log security event (in production, send to SIEM)
          console.warn('[SECURITY] XSS attempt detected in contact form', {
            patterns: sanitized.patterns,
            emailHash: await this.hashForLogging(email),
            timestamp: new Date().toISOString(),
          });
        }

        // Validate that sanitization produced valid data
        if (!sanitized.name || sanitized.name.length < 1) {
          throw Errors.validation([{ path: ['name'], message: 'Name is required after sanitization' }]);
        }

        if (!sanitized.email || sanitized.email.length < 1) {
          throw Errors.validation([{ path: ['email'], message: 'Valid email is required' }]);
        }

        if (!sanitized.message || sanitized.message.length < 1) {
          throw Errors.validation([{ path: ['message'], message: 'Message is required after sanitization' }]);
        }

        const created = await this.contacts.create({
          name: sanitized.name,
          email: sanitized.email,
          message: sanitized.message,
        });

        span.setAttribute('contact.id', created.id);
        span.end();

        return { id: created.id };
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: 2 });
        span.end();
        throw err;
      }
    });
  }

  /**
   * Creates a hash of sensitive data for logging purposes
   * Prevents PII leakage in logs while allowing correlation
   */
  private async hashForLogging(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }
}
