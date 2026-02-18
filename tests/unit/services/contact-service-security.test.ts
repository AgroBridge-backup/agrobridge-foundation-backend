import { describe, expect, it, vi } from 'vitest';

import { ContactService } from '../../src/services/contact-service.js';
import {
  sanitizePlainText,
  sanitizeRichText,
  detectXssPatterns,
  sanitizeEmail,
  sanitizeContactForm,
} from '../../src/lib/xss-sanitizer.js';

/**
 * XSS Prevention Test Suite
 * 
 * Comprehensive tests for XSS sanitization and attack prevention.
 * Tests cover all major XSS vectors from OWASP XSS Cheat Sheet.
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @security Critical - Tests must pass before deployment
 */

describe('XSS Sanitization', () => {
  describe('sanitizePlainText', () => {
    it('removes script tags', () => {
      const input = '<script>alert("xss")</script>Hello World';
      const result = sanitizePlainText(input);
      expect(result).toBe('Hello World');
      expect(result).not.toContain('<script>');
    });

    it('removes event handlers', () => {
      const input = '<img src=x onerror=alert("xss")>';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('onerror');
      expect(result).not.toContain('alert');
    });

    it('removes javascript: protocol', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('alert');
    });

    it('removes data URIs', () => {
      const input = '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('data:');
    });

    it('removes SVG with embedded script', () => {
      const input = '<svg onload=alert(1)>';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('onload');
    });

    it('handles nested HTML tags', () => {
      const input = '<div><span><script>alert(1)</script></span></div>';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('<script>');
    });

    it('preserves plain text content', () => {
      const input = 'Hello World! This is a test message.';
      const result = sanitizePlainText(input);
      expect(result).toBe('Hello World! This is a test message.');
    });

    it('handles special characters', () => {
      const input = 'Hello < World > & "test" quotes';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('handles empty input', () => {
      expect(sanitizePlainText('')).toBe('');
      expect(sanitizePlainText(null as any)).toBe('');
      expect(sanitizePlainText(undefined as any)).toBe('');
    });

    it('removes template expressions (Angular/Vue)', () => {
      const input = '{{constructor.constructor("alert(1)")()}}';
      const result = sanitizePlainText(input);
      expect(result).not.toContain('{{');
    });
  });

  describe('sanitizeRichText', () => {
    it('allows safe HTML tags', () => {
      const input = '<p>Hello <strong>World</strong></p>';
      const result = sanitizeRichText(input);
      expect(result).toContain('<p>');
      expect(result).toContain('<strong>');
    });

    it('removes script tags from rich text', () => {
      const input = '<p>Hello</p><script>alert(1)</script>';
      const result = sanitizeRichText(input);
      expect(result).toContain('<p>');
      expect(result).not.toContain('<script>');
    });

    it('removes event handlers from rich text', () => {
      const input = '<p onclick="alert(1)">Click me</p>';
      const result = sanitizeRichText(input);
      expect(result).not.toContain('onclick');
    });
  });

  describe('detectXssPatterns', () => {
    it('detects script tags', () => {
      const result = detectXssPatterns('<script>alert(1)</script>');
      expect(result.hasXss).toBe(true);
      expect(result.patterns).toContain('SCRIPT_TAG');
      expect(result.severity).toBe('high');
    });

    it('detects event handlers', () => {
      const result = detectXssPatterns('<img onerror=alert(1)>');
      expect(result.hasXss).toBe(true);
      expect(result.patterns).toContain('EVENT_HANDLERS');
    });

    it('detects javascript protocol', () => {
      const result = detectXssPatterns('javascript:alert(1)');
      expect(result.hasXss).toBe(true);
      expect(result.patterns).toContain('JS_PROTOCOL');
      expect(result.severity).toBe('high');
    });

    it('detects template expressions', () => {
      const result = detectXssPatterns('{{alert(1)}}');
      expect(result.hasXss).toBe(true);
      expect(result.patterns).toContain('TEMPLATE_EXPRESSION');
    });

    it('returns no XSS for safe content', () => {
      const result = detectXssPatterns('Hello World, this is safe!');
      expect(result.hasXss).toBe(false);
      expect(result.patterns).toHaveLength(0);
      expect(result.severity).toBe('none');
    });
  });

  describe('sanitizeEmail', () => {
    it('returns sanitized email for valid input', () => {
      const result = sanitizeEmail('test@example.com');
      expect(result).toBe('test@example.com');
    });

    it('rejects emails with XSS in local part', () => {
      const result = sanitizeEmail('<script>@example.com');
      expect(result).toBeNull();
    });

    it('rejects invalid email format', () => {
      expect(sanitizeEmail('not-an-email')).toBeNull();
      expect(sanitizeEmail('@example.com')).toBeNull();
      expect(sanitizeEmail('test@')).toBeNull();
    });

    it('sanitizes email with special chars', () => {
      const result = sanitizeEmail('user+test@example.com');
      expect(result).toBe('user+test@example.com');
    });

    it('handles null/undefined input', () => {
      expect(sanitizeEmail(null as any)).toBeNull();
      expect(sanitizeEmail(undefined as any)).toBeNull();
      expect(sanitizeEmail('')).toBeNull();
    });
  });

  describe('sanitizeContactForm', () => {
    it('sanitizes all fields correctly', () => {
      const input = {
        name: '<script>alert(1)</script>John',
        email: 'john@example.com',
        message: '<p>Hello <img src=x onerror=alert(1)></p>',
        source: 'website',
        page: '/contact',
      };

      const result = sanitizeContactForm(input);

      expect(result.name).toBe('John');
      expect(result.email).toBe('john@example.com');
      expect(result.message).not.toContain('<script>');
      expect(result.message).not.toContain('onerror');
      expect(result.xssDetected).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('detects XSS in name field', () => {
      const input = {
        name: '<svg onload=alert(1)>',
        email: 'test@example.com',
        message: 'Normal message',
        source: '',
        page: '',
      };

      const result = sanitizeContactForm(input);
      expect(result.xssDetected).toBe(true);
      expect(result.name).not.toContain('<svg');
    });

    it('handles empty optional fields', () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        message: 'Hello!',
        source: '',
        page: '',
      };

      const result = sanitizeContactForm(input);
      expect(result.xssDetected).toBe(false);
      expect(result.source).toBe('');
      expect(result.page).toBe('');
    });
  });
});

describe('XSS Payload Tests (OWASP Cheat Sheet)', () => {
  const xssPayloads = [
    { name: 'Basic script tag', payload: '<script>alert("XSS")</script>' },
    { name: 'Script with src', payload: '<script src="http://evil.com/xss.js"></script>' },
    { name: 'Image onerror', payload: '<img src=x onerror=alert("XSS")>' },
    { name: 'Body onload', payload: '<body onload=alert("XSS")>' },
    { name: 'Iframe javascript', payload: '<iframe src="javascript:alert(1)">' },
    { name: 'Input onfocus', payload: '<input onfocus=alert("XSS") autofocus>' },
    { name: 'Video onerror', payload: '<video><source onerror="alert(1)">' },
    { name: 'SVG onload', payload: '<svg onload=alert(1)>' },
    { name: 'Object data', payload: '<object data="javascript:alert(1)">' },
    { name: 'Embed src', payload: '<embed src="javascript:alert(1)">' },
    { name: 'Form action', payload: '<form action="javascript:alert(1)"><input type=submit>' },
    { name: 'Link onclick', payload: '<a href="#" onclick="alert(1)">Click</a>' },
    { name: 'Div onmouseover', payload: '<div onmouseover="alert(1)">Hover</div>' },
    { name: 'Template expression', payload: '{{constructor.constructor("alert(1)")()}}' },
    { name: 'Meta refresh', payload: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">' },
    { name: 'Data URI HTML', payload: 'data:text/html,<script>alert(1)</script>' },
  ];

  xssPayloads.forEach(({ name, payload }) => {
    it(`sanitizes: ${name}`, () => {
      const result = sanitizePlainText(payload);
      
      expect(result).not.toMatch(/<script[\s>]/i);
      expect(result).not.toMatch(/javascript:/i);
      expect(result).not.toMatch(/on\w+\s*=/i);
      
      const detection = detectXssPatterns(payload);
      expect(detection.hasXss).toBe(true);
    });
  });
});

describe('ContactService XSS Prevention', () => {
  it('sanitizes message before storing', async () => {
    const mockRepo = {
      create: vi.fn(async (data: { name: string; email: string; message: string }) => ({
        id: 'test-id',
        ...data,
      })),
    };

    const service = new ContactService(mockRepo as any);
    
    const result = await service.create({
      name: 'Test User',
      email: 'test@example.com',
      message: '<script>alert("XSS")</script>Hello World',
    });

    expect(result.id).toBe('test-id');
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining('<script>'),
      })
    );
  });

  it('sanitizes name field', async () => {
    const mockRepo = {
      create: vi.fn(async (data: { name: string; email: string; message: string }) => ({
        id: 'test-id',
        ...data,
      })),
    };

    const service = new ContactService(mockRepo as any);
    
    await service.create({
      name: '<svg onload=alert(1)>John',
      email: 'john@example.com',
      message: 'Normal message',
    });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.not.stringContaining('<svg'),
      })
    );
  });

  it('rejects invalid email with XSS', async () => {
    const service = new ContactService({ create: async () => ({ id: 'x' }) } as any);
    
    await expect(
      service.create({
        name: 'Test',
        email: '<script>@example.com',
        message: 'Test message',
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('handles XSS detection logging', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    const mockRepo = {
      create: vi.fn(async (data: { name: string; email: string; message: string }) => ({
        id: 'test-id',
        ...data,
      })),
    };

    const service = new ContactService(mockRepo as any);
    
    await service.create({
      name: 'Test',
      email: 'test@example.com',
      message: '<script>alert(1)</script>',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[SECURITY] XSS attempt detected in contact form',
      expect.objectContaining({
        patterns: expect.any(Array),
        emailHash: expect.any(String),
        timestamp: expect.any(String),
      })
    );

    consoleSpy.mockRestore();
  });

  it('preserves valid content after sanitization', async () => {
    const mockRepo = {
      create: vi.fn(async (data: { name: string; email: string; message: string }) => ({
        id: 'test-id',
        ...data,
      })),
    };

    const service = new ContactService(mockRepo as any);
    
    await service.create({
      name: 'John Doe',
      email: 'john.doe@example.com',
      message: 'Hello! I am interested in your foundation. Please contact me.',
    });

    expect(mockRepo.create).toHaveBeenCalledWith({
      name: 'John Doe',
      email: 'john.doe@example.com',
      message: 'Hello! I am interested in your foundation. Please contact me.',
    });
  });
});

describe('Edge Cases and Bypass Attempts', () => {
  it('handles HTML entities', () => {
    const input = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const result = sanitizePlainText(input);
    expect(result).not.toContain('<script>');
  });

  it('handles mixed case tags', () => {
    const input = '<ScRiPt>alert(1)</ScRiPt>';
    const result = sanitizePlainText(input);
    expect(result).not.toMatch(/<script/i);
  });

  it('handles attribute injection', () => {
    const input = 'name" onmouseover="alert(1)';
    const result = sanitizePlainText(input);
    expect(result).not.toContain('onmouseover');
  });

  it('handles newline XSS', () => {
    const input = '<img src=x onerror=alert(1)>';
    const result = sanitizePlainText(input);
    expect(result).not.toContain('onerror');
  });
});
