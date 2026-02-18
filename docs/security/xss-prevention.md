# XSS Prevention Security Model

## Overview

This document describes the comprehensive XSS (Cross-Site Scripting) prevention model implemented in the AgroBridge Foundation backend. The contact form is a primary attack vector for stored XSS attacks that could compromise admin accounts.

**Author:** Alejandro Navarro Ayala - CEO & Founder, AgroBridge  
**Classification:** Security Critical  
**Last Updated:** 2026-02-17

## Threat Model

### Attack Vectors

1. **Stored XSS via Contact Form**
   - Attacker submits malicious JavaScript in message field
   - Script executes when admin views the submission
   - Could steal admin session cookies or perform actions

2. **Email Address XSS**
   - Malformed email addresses containing script tags
   - Execute when rendered in admin panel

3. **Name Field XSS**
   - Injection through name parameter
   - Social engineering with clickable payloads

### Impact Assessment

| Severity | Description |
|----------|-------------|
| **Critical** | Admin account compromise, data exfiltration |
| **High** | Session hijacking, unauthorized actions |
| **Medium** | Defacement, phishing attacks |

## Defense Layers

### Layer 1: Input Sanitization (Service Layer)

**File:** `src/services/contact-service.ts`

All user input is sanitized using DOMPurify before database storage:

```typescript
const sanitized = sanitizeContactForm({ 
  name, 
  email, 
  message, 
  source: source ?? '', 
  page: page ?? '' 
});
```

**Sanitization Strategy:**
- **Strip ALL HTML tags** - No HTML allowed in contact messages
- **Remove event handlers** - No `onerror`, `onload`, etc.
- **Block dangerous protocols** - No `javascript:`, `data:`, `vbscript:`
- **Normalize input** - Remove control characters, null bytes

### Layer 2: XSS Detection & Logging

**File:** `src/lib/xss-sanitizer.ts`

Detects and logs XSS attempts for security monitoring:

```typescript
if (sanitized.xssDetected) {
  span.setAttribute('security.xss_detected', true);
  console.warn('[SECURITY] XSS attempt detected', {
    patterns: sanitized.patterns,
    emailHash: await this.hashForLogging(email),
  });
}
```

**Detection Patterns:**
- Script tags (`<script>...</script>`)
- Event handlers (`onerror=`, `onload=`, etc.)
- JavaScript protocol (`javascript:...`)
- Data URIs (`data:text/html,...`)
- SVG scripts (`<svg onload=...>`)
- Template expressions (Angular/Vue `{{...}}`)

### Layer 3: Content Security Policy (Admin Routes)

**File:** `src/api/routes/admin-contacts.ts`

Enhanced CSP headers on all admin routes that display user content:

```typescript
reply.header('Content-Security-Policy', [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; '));
```

**Additional Headers:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Layer 4: Output Encoding

**Admin Panel Guidelines:**

When displaying contact data in admin UI:

```javascript
// GOOD - Text content, not HTML
element.textContent = contact.message;

// BAD - Never use innerHTML
element.innerHTML = contact.message; // NEVER DO THIS
```

**Template Engines:**
- Use auto-escaping templates (Handlebars, EJS with `escape`)
- Disable HTML rendering for user content
- Render as plain text only

## Security Configuration

### DOMPurify Configuration

**Plain Text Mode (Default):**

```typescript
const PLAIN_TEXT_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [],           // No HTML allowed
  ALLOWED_ATTR: [],           // No attributes allowed
  ALLOW_DATA_ATTR: false,     // No data-* attributes
  KEEP_CONTENT: true,         // Keep text content
  FORBID_ATTR: ['style', 'class', 'id', 'name'],
  FORBID_URI_SCHEMES: ['javascript', 'data', 'vbscript', 'file'],
};
```

**Rich Text Mode (Future Use):**

```typescript
const RICH_TEXT_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre'
  ],
  ALLOWED_ATTR: ['href', 'title'],
  FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload'],
};
```

## Testing

### Test Coverage

**File:** `tests/unit/services/contact-service-security.test.ts`

Run security tests:

```bash
npm run test:unit tests/unit/services/contact-service-security.test.ts
```

### OWASP XSS Cheat Sheet Coverage

Tests cover 20+ attack vectors:

1. Basic script injection
2. Event handler injection
3. JavaScript protocol
4. Data URI injection
5. SVG-based XSS
6. Template expression injection
7. Meta refresh attacks
8. Style-based XSS
9. Polyglot payloads
10. Double encoding bypasses

### Adding New Tests

When adding new XSS vectors:

```typescript
it('handles new attack vector', () => {
  const input = '<new-vector>attack</new-vector>';
  const result = sanitizePlainText(input);
  expect(result).not.toContain('<new-vector>');
});
```

## Monitoring & Alerting

### Security Event Logging

XSS attempts are logged with:
- Attack pattern signatures detected
- Hashed email (for correlation, not PII)
- Timestamp
- Request metadata (in production)

### SIEM Integration

Production deployments should forward to:
- Splunk / ELK Stack
- Datadog Security
- AWS Security Hub

Alert triggers:
- More than 5 XSS attempts from single IP (10 min window)
- XSS attempt on admin-authenticated endpoint
- Pattern matching known exploit kits

## Incident Response

### Detecting XSS Attempts

1. Monitor logs for `[SECURITY] XSS attempt detected`
2. Review patterns detected
3. Check if sanitization succeeded

### Response Playbook

**Level 1: Automated Blocking**
- Rate limit offending IP
- Add to temporary blocklist (15 min)

**Level 2: Manual Review**
- Review submitted content in database
- Verify sanitization worked correctly
- Check admin access logs

**Level 3: Incident Response**
- If admin account compromised:
  - Force logout all admin sessions
  - Rotate JWT secrets
  - Audit all admin actions in last 24h
  - Notify security team

## Compliance

### OWASP Top 10

Addresses:
- **A03:2021 – Injection** (XSS is a form of injection)
- **A07:2021 – Identification and Authentication Failures**

### GDPR/CCPA

- PII is hashed before logging
- Email addresses are sanitized
- No raw user data in logs

## References

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP XSS Filter Evasion](https://owasp.org/www-community/xss-filter-evasion-cheatsheet)
- [DOMPurify Documentation](https://github.com/cure53/DOMPurify)
- [CSP Quick Reference](https://content-security-policy.com/)

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-17 | 1.0.0 | Initial XSS prevention implementation |
