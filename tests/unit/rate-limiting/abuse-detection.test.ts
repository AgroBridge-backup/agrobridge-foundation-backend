import { describe, expect, it } from 'vitest';

import { AbuseDetector } from '../../../src/rate-limiting/abuse-detection.js';

function makeRequest(ip: string, url: string, method = 'POST', body: unknown = {}) {
  return {
    ip,
    method,
    body,
    routeOptions: { url },
  } as any;
}

describe('AbuseDetector', () => {
  it('does not count every /auth/login request as failed by default', async () => {
    const detector = new AbuseDetector();
    const result = await detector.detectAbuse(makeRequest('10.0.0.1', '/api/auth/login'));

    expect(result.reasons.some((reason) => reason.includes('failed login attempts'))).toBe(false);
    expect(result.score).toBe(0);
  });

  it('flags repeated failed logins only after explicit failure recording', async () => {
    const detector = new AbuseDetector();
    const ip = '10.0.0.2';

    for (let i = 0; i < 5; i++) {
      detector.recordFailedLogin(ip);
    }

    const result = await detector.detectAbuse(makeRequest(ip, '/api/admin/dashboard', 'GET'));
    expect(result.reasons.some((reason) => reason.includes('failed login attempts'))).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it('resets failed login signal after successful login', async () => {
    const detector = new AbuseDetector();
    const ip = '10.0.0.3';

    for (let i = 0; i < 5; i++) {
      detector.recordFailedLogin(ip);
    }
    detector.recordSuccessfulLogin(ip);

    const result = await detector.detectAbuse(makeRequest(ip, '/api/auth/login'));
    expect(result.reasons.some((reason) => reason.includes('failed login attempts'))).toBe(false);
  });
});
