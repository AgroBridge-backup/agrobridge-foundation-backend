import { FastifyRequest } from 'fastify';
import { RateLimitTier } from './tier-config.js';

export interface AbuseScore {
  score: number;
  threshold: number;
  isAbusive: boolean;
  tier: RateLimitTier;
  reasons: string[];
}

interface AbuseMetrics {
  failedAttempts: number;
  rapidRequests: number;
  suspiciousPatterns: number;
  lastRequestTime: number;
  requestCountInWindow: number;
}

const abuseStore = new Map<string, AbuseMetrics>();

export class AbuseDetector {
  private readonly ABUSE_THRESHOLD = 50;
  private readonly RAPID_REQUEST_THRESHOLD = 10;
  private readonly FAILED_LOGIN_THRESHOLD = 5;
  private readonly WINDOW_MS = 1000;

  async detectAbuse(req: FastifyRequest): Promise<AbuseScore> {
    const ip = req.ip || 'unknown';
    const now = Date.now();

    let metrics = abuseStore.get(ip);
    if (!metrics) {
      metrics = {
        failedAttempts: 0,
        rapidRequests: 0,
        suspiciousPatterns: 0,
        lastRequestTime: now,
        requestCountInWindow: 0,
      };
    }

    const reasons: string[] = [];
    let score = 0;

    const timeSinceLastRequest = now - metrics.lastRequestTime;

    if (timeSinceLastRequest > this.WINDOW_MS) {
      metrics.requestCountInWindow = 0;
    }
    metrics.requestCountInWindow++;
    metrics.lastRequestTime = now;

    if (metrics.requestCountInWindow >= this.RAPID_REQUEST_THRESHOLD) {
      score += 30;
      reasons.push(`Rapid requests detected (${metrics.requestCountInWindow} req/sec)`);
      metrics.rapidRequests = metrics.requestCountInWindow;
    }

    if (req.routeOptions.url === '/api/auth/login' && req.method === 'POST') {
      metrics.failedAttempts++;
      if (metrics.failedAttempts >= this.FAILED_LOGIN_THRESHOLD) {
        score += 40;
        reasons.push(`Multiple failed login attempts (${metrics.failedAttempts})`);
      }
    }

    if (this.detectSuspiciousPattern(ip, req)) {
      score += 20;
      reasons.push('Suspicious request pattern detected');
      metrics.suspiciousPatterns++;
    }

    const isAbusive = score >= this.ABUSE_THRESHOLD;
    const tier = isAbusive ? RateLimitTier.ABUSE : RateLimitTier.PUBLIC;

    abuseStore.set(ip, metrics);

    return {
      score,
      threshold: this.ABUSE_THRESHOLD,
      isAbusive,
      tier,
      reasons,
    };
  }

  private getRecentRequestCount(ip: string, windowMs: number): number {
    const metrics = abuseStore.get(ip);
    if (!metrics) return 0;

    const now = Date.now();
    const timeSinceLastRequest = now - metrics.lastRequestTime;

    if (timeSinceLastRequest > windowMs) {
      return 0;
    }

    return metrics.requestCountInWindow;
  }

  private detectSuspiciousPattern(ip: string, req: FastifyRequest): boolean {
    const suspiciousPatterns = [/<script/i, /union.*select/i, /\.\./, /etc\/passwd/i];
    const body = JSON.stringify(req.body || {});
    return suspiciousPatterns.some((pattern) => pattern.test(body));
  }

  cleanup(): void {
    const now = Date.now();
    const expirationTime = 60 * 60 * 1000;

    for (const [key, entry] of abuseStore.entries()) {
      if (now - entry.lastRequestTime > expirationTime) {
        abuseStore.delete(key);
      }
    }
  }
}
