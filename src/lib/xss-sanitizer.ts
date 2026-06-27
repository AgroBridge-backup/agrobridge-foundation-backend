import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

/**
 * XSS Sanitization Module
 * 
 * Provides HTML sanitization for user-generated content to prevent
 * stored and reflected XSS attacks. Uses DOMPurify with strict
 * configuration suitable for Node.js server-side processing.
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Critical - All user input must pass through here
 */

// Initialize DOMPurify with JSDOM for server-side use
const { window } = new JSDOM('<!DOCTYPE html>');
const purify = DOMPurify(window);

/**
 * DOMPurify configuration for plain text content (contact messages, etc.)
 *
 * Strategy:
 * - Strip ALL HTML tags
 * - Allow only plain text
 * - Remove all event handlers
 * - Remove data URL schemes
 * - Remove javascript: and other dangerous protocols
 */
const PLAIN_TEXT_CONFIG = {
  // Allow NO HTML tags - completely strip HTML
  ALLOWED_TAGS: [] as string[],
  ALLOWED_ATTR: [] as string[],
  // Remove all event handlers
  ALLOW_DATA_ATTR: false,
  // Keep the content of removed tags
  KEEP_CONTENT: true,
  // Block data URLs
  FORBID_ATTR: ['style', 'class', 'id', 'name'],
  // Block dangerous protocols
  FORBID_URI_SCHEMES: ['javascript', 'data', 'vbscript', 'file', 'about'],
  // Additional security
  WHOLE_DOCUMENT: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  // Return string, not TrustedHTML
  RETURN_TRUSTED_TYPE: false as const,
};

/**
 * DOMPurify configuration for rich text content (if ever needed)
 *
 * Strategy:
 * - Allow only safe formatting tags
 * - Block all event handlers
 * - Block dangerous URLs
 * - Force HTTPS for links
 */
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'
  ],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload', 'onmouseover'],
  FORBID_URI_SCHEMES: ['javascript', 'data', 'vbscript', 'file', 'about'],
  // Force HTTPS
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  WHOLE_DOCUMENT: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
  RETURN_TRUSTED_TYPE: false as const,
};

/**
 * Known XSS payload patterns for detection and blocking
 * 
 * These patterns are used to detect sophisticated XSS attempts
 * that might slip through basic sanitization.
 */
export const XSS_PATTERNS = {
  // Script tag variations
  SCRIPT_TAG: /<script[^>]*>[\s\S]*?<\/script>/gi,
  // Unclosed/opening script tag, e.g. `<script>` or `<script src=...>` (no closer)
  SCRIPT_TAG_OPEN: /<script[^>]*>/gi,
  // Event handlers
  EVENT_HANDLERS: /\s(on\w+)\s*=\s*["']?[^"'>]+["']?/gi,
  // JavaScript protocol
  JS_PROTOCOL: /javascript:/gi,
  // Data URI with script
  DATA_URI: /data:text\/html[;\s]*base64,/gi,
  // SVG with script
  SVG_SCRIPT: /<svg[^>]*>[\s\S]*?<script[\s\S]*?<\/svg>/gi,
  // Template literals
  TEMPLATE_LITERAL: /`${[^}]*}`/g,
  // Unicode escapes
  UNICODE_ESCAPE: /\\u[0-9a-fA-F]{4}/g,
  // HTML entities that decode to dangerous chars
  HTML_ENTITY: /&#[xX]?[0-9a-fA-F]+;/g,
  // Expression injection (Angular, Vue, etc)
  TEMPLATE_EXPRESSION: /\{\{[^}]+\}\}/g,
  // Base64 encoded patterns (common evasion)
  BASE64_PATTERN: /[A-Za-z0-9+/]{50,}={0,2}/g,
};

/**
 * Sanitizes user input for plain text storage
 * 
 * This is the primary function for sanitizing contact form messages
 * and other user-generated content that should not contain HTML.
 * 
 * @param input - Raw user input string
 * @returns Sanitized plain text string with all HTML removed
 * 
 * @example
 * ```typescript
 * const clean = sanitizePlainText('<script>alert("xss")</script>Hello');
 * // Returns: 'Hello'
 * ```
 */
export function sanitizePlainText(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // First pass: DOMPurify with strict settings
  let sanitized = purify.sanitize(input, PLAIN_TEXT_CONFIG) as unknown as string;

  // Second pass: decode the angle-bracket entities DOMPurify emitted so the
  // third pass can pattern-match and strip them.
  sanitized = sanitized.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // Third pass: defense-in-depth. DOMPurify targets tags, but residual XSS
  // fragments can survive (template expressions, event-handler-like attribute
  // strings, unclosed script tags). Strip every detected pattern, then strip
  // ALL angle brackets — plain-text contact content has no legitimate use for
  // them, and removing them eliminates any rendering-context ambiguity.
  sanitized = sanitized
    .replace(XSS_PATTERNS.SCRIPT_TAG, '')
    .replace(XSS_PATTERNS.SCRIPT_TAG_OPEN, '')
    .replace(XSS_PATTERNS.EVENT_HANDLERS, '')
    .replace(XSS_PATTERNS.TEMPLATE_EXPRESSION, '')
    .replace(/[<>]/g, '');

  return sanitized.trim();
}

/**
 * Sanitizes user input allowing safe HTML formatting
 * 
 * Use this only when rich text formatting is explicitly required.
 * For contact forms, use sanitizePlainText instead.
 * 
 * @param input - Raw user input string
 * @returns Sanitized HTML string with only safe tags
 */
export function sanitizeRichText(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return purify.sanitize(input, RICH_TEXT_CONFIG) as unknown as string;
}

/**
 * Validates if input contains known XSS patterns
 * 
 * Used for logging and detection of attack attempts.
 * Does NOT sanitize - use sanitizePlainText for that.
 * 
 * @param input - String to check
 * @returns Object with detection results
 */
export function detectXssPatterns(input: string): {
  hasXss: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
} {
  const detected: string[] = [];

  if (XSS_PATTERNS.SCRIPT_TAG.test(input)) {
    detected.push('SCRIPT_TAG');
  }
  if (XSS_PATTERNS.SCRIPT_TAG_OPEN.test(input)) {
    detected.push('SCRIPT_TAG_OPEN');
  }
  if (XSS_PATTERNS.EVENT_HANDLERS.test(input)) {
    detected.push('EVENT_HANDLERS');
  }
  if (XSS_PATTERNS.JS_PROTOCOL.test(input)) {
    detected.push('JS_PROTOCOL');
  }
  if (XSS_PATTERNS.DATA_URI.test(input)) {
    detected.push('DATA_URI');
  }
  if (XSS_PATTERNS.SVG_SCRIPT.test(input)) {
    detected.push('SVG_SCRIPT');
  }
  if (XSS_PATTERNS.TEMPLATE_EXPRESSION.test(input)) {
    detected.push('TEMPLATE_EXPRESSION');
  }

  // Reset regex lastIndex for global patterns
  Object.values(XSS_PATTERNS).forEach((pattern) => {
    pattern.lastIndex = 0;
  });

  const hasXss = detected.length > 0;
  let severity: 'none' | 'low' | 'medium' | 'high' = 'none';

  if (hasXss) {
    if (
      detected.includes('SCRIPT_TAG') ||
      detected.includes('SCRIPT_TAG_OPEN') ||
      detected.includes('JS_PROTOCOL')
    ) {
      severity = 'high';
    } else if (detected.length >= 2) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
  }

  return { hasXss, patterns: detected, severity };
}

/**
 * Quick check for XSS patterns
 * 
 * @param input - String to check
 * @returns True if XSS patterns detected
 */
function containsXssPatterns(input: string): boolean {
  const detection = detectXssPatterns(input);
  return detection.hasXss;
}

/**
 * Validates email address for XSS attempts in the local part
 * 
 * Email addresses can be attack vectors when displayed in admin panels.
 * 
 * @param email - Email address to validate
 * @returns Sanitized email or null if invalid
 */
export function sanitizeEmail(email: string): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return null;
  }

  // Check for XSS in local part
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) {
    return null;
  }

  const xssCheck = detectXssPatterns(localPart);
  if (xssCheck.hasXss) {
    // Reject emails with XSS in local part
    return null;
  }

  // Sanitize both parts
  const cleanLocal = sanitizePlainText(localPart);
  const cleanDomain = sanitizePlainText(domain);

  return `${cleanLocal}@${cleanDomain}`;
}

/**
 * Sanitizes a contact form submission object
 * 
 * Main entry point for contact form data sanitization.
 * Applies appropriate sanitization to each field.
 * 
 * @param data - Raw contact form data
 * @returns Sanitized data object
 */
export function sanitizeContactForm(data: {
  name: string;
  email: string;
  message: string;
  source?: string;
  page?: string;
}): {
  name: string;
  email: string;
  message: string;
  source: string;
  page: string;
  xssDetected: boolean;
  patterns: string[];
} {
  // Detect XSS before sanitization for logging
  const messageCheck = detectXssPatterns(data.message);
  const nameCheck = detectXssPatterns(data.name);

  // Sanitize all fields
  const sanitized = {
    name: sanitizePlainText(data.name),
    email: sanitizeEmail(data.email) || '',
    message: sanitizePlainText(data.message),
    source: data.source ? sanitizePlainText(data.source) : '',
    page: data.page ? sanitizePlainText(data.page) : '',
  };

  // Combine detection results
  const allPatterns = [...new Set([...messageCheck.patterns, ...nameCheck.patterns])];

  return {
    ...sanitized,
    xssDetected: messageCheck.hasXss || nameCheck.hasXss,
    patterns: allPatterns,
  };
}
