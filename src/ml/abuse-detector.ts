import { trace, Span, SpanStatusCode, context } from '@opentelemetry/api';
import { LRUCache } from '../utils/lru-cache.js';
import {
  CircuitBreaker,
  CircuitState,
  type CircuitBreakerConfig,
} from '../utils/circuit-breaker.js';
import * as metrics from '../observability/metrics/rate-limiting-metrics.js';

// OpenTelemetry tracer for abuse detection
const tracer = trace.getTracer('abuse-detector', '1.0.0');

export interface HttpRequest {
  ip?: string;
  userAgent?: string;
  url?: string;
  method?: string;
  userId?: string;
  apiKey?: string;
  timestamp: number;
}

export interface AbuseFeatures {
  ipReputation: number;
  requestFrequency: number;
  userBehavior: number;
  timeOfDay: number;
  geoLocation: string;
  isKnownBot: boolean;
  isVpn: boolean;
  isTor: boolean;
  suspiciousPatterns: number;
}

export interface AbusePrediction {
  abuseProbability: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  factors: Record<string, number>;
}

export class MLAbuseDetector {
  private readonly ipReputationCache: LRUCache<string, { score: number; timestamp: number }>;
  private readonly userFrequencyCache: LRUCache<string, { count: number; window: number[] }>;
  private cacheTTL: number;
  private maxCacheSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly reputationServiceEndpoint: string;
  private readonly geoIpServiceEndpoint: string;
  private readonly highRiskCountries: Set<string>;

  // Circuit breakers for external services
  private readonly ipReputationBreaker: CircuitBreaker<number>;
  private readonly vpnCheckBreaker: CircuitBreaker<boolean>;
  private readonly torCheckBreaker: CircuitBreaker<boolean>;
  private readonly geoLocationBreaker: CircuitBreaker<string>;

  constructor(
    config: {
      reputationService?: string;
      geoIpService?: string;
      cacheTTL?: number;
      maxCacheSize?: number;
      cleanupIntervalMs?: number;
      highRiskCountries?: string[];
    } = {},
  ) {
    // Read from environment variables first, then config, then defaults
    const envCacheTTL = process.env.ABUSE_DETECTOR_CACHE_TTL;
    const envMaxCacheSize = process.env.ABUSE_DETECTOR_MAX_CACHE_SIZE;
    const envCleanupInterval = process.env.ABUSE_DETECTOR_CLEANUP_INTERVAL_MS;
    const envReputationService = process.env.ABUSE_DETECTOR_REPUTATION_SERVICE;
    const envGeoIpService = process.env.ABUSE_DETECTOR_GEOIP_SERVICE;
    const envHighRiskCountries = process.env.ABUSE_DETECTOR_HIGH_RISK_COUNTRIES;

    // Set config values (env var > config > default)
    this.cacheTTL = envCacheTTL ? parseInt(envCacheTTL, 10) : (config.cacheTTL ?? 60_000);
    this.maxCacheSize = envMaxCacheSize
      ? parseInt(envMaxCacheSize, 10)
      : (config.maxCacheSize ?? 10000);

    this.reputationServiceEndpoint =
      envReputationService || config.reputationService || 'http://ip-reputation:8080';
    this.geoIpServiceEndpoint = envGeoIpService || config.geoIpService || 'http://geoip:8080';

    // Parse high risk countries from env (comma-separated)
    const highRiskCountriesList = envHighRiskCountries
      ? envHighRiskCountries.split(',').map((c) => c.trim())
      : config.highRiskCountries || [];
    this.highRiskCountries = new Set(highRiskCountriesList);

    // Validate configuration
    this.validateConfig();

    // Initialize LRU caches with max size enforcement
    this.ipReputationCache = new LRUCache(this.maxCacheSize);
    this.userFrequencyCache = new LRUCache(this.maxCacheSize);

    // Initialize circuit breakers with adaptive timeouts
    const baseBreakerConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      openDuration: 60_000, // 1 minute
      successThreshold: 3,
      timeout: 1000,
      adaptiveTimeout: {
        enabled: true,
        minTimeout: 500,
        maxTimeout: 5000,
        p99LatencyFactor: 1.5,
      },
    };

    this.ipReputationBreaker = new CircuitBreaker<number>(baseBreakerConfig, 'ip-reputation');
    this.vpnCheckBreaker = new CircuitBreaker<boolean>(baseBreakerConfig, 'vpn-check');
    this.torCheckBreaker = new CircuitBreaker<boolean>(baseBreakerConfig, 'tor-check');
    this.geoLocationBreaker = new CircuitBreaker<string>(baseBreakerConfig, 'geo-location');

    // Start cleanup interval
    const cleanupIntervalMs = envCleanupInterval
      ? parseInt(envCleanupInterval, 10)
      : (config.cleanupIntervalMs ?? 30000);
    this.cleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Validate configuration values and warn about invalid settings
   */
  private validateConfig(): void {
    if (this.cacheTTL < 1000) {
      console.warn('[MLAbuseDetector] cacheTTL too low (<1s), using default 60000ms');
      this.cacheTTL = 60_000;
    }
    if (this.cacheTTL > 3600_000) {
      console.warn('[MLAbuseDetector] cacheTTL too high (>1h), using default 60000ms');
      this.cacheTTL = 60_000;
    }
    if (this.maxCacheSize < 100) {
      console.warn('[MLAbuseDetector] maxCacheSize too low (<100), using default 10000');
      this.maxCacheSize = 10000;
    }
    if (this.maxCacheSize > 1000000) {
      console.warn('[MLAbuseDetector] maxCacheSize too high (>1M), using default 10000');
      this.maxCacheSize = 10000;
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.ipReputationCache.clear();
    this.userFrequencyCache.clear();

    // Log circuit breaker metrics on shutdown
    console.log('[MLAbuseDetector] Circuit breaker metrics on shutdown:', {
      ipReputation: this.ipReputationBreaker.getMetrics(),
      vpnCheck: this.vpnCheckBreaker.getMetrics(),
      torCheck: this.torCheckBreaker.getMetrics(),
      geoLocation: this.geoLocationBreaker.getMetrics(),
    });
  }

  async checkRequest(request: HttpRequest): Promise<AbusePrediction> {
    return tracer.startActiveSpan(
      'abuse_detector.check_request',
      {
        attributes: {
          'abuse_detector.ip': request.ip || 'unknown',
          'abuse_detector.user_id': request.userId || 'unknown',
          'abuse_detector.method': request.method || 'unknown',
          'abuse_detector.url': request.url || 'unknown',
        },
      },
      async (span: Span) => {
        const startTime = process.hrtime.bigint();

        try {
          // Fast-fail if all external services are unhealthy
          if (this.shouldSkipExternalChecks()) {
            span.setAttributes({
              'abuse_detector.fast_fail': true,
              'abuse_detector.degraded_mode': true,
            });
            span.setStatus({ code: SpanStatusCode.OK, message: 'Fast-fail mode' });

            const result: AbusePrediction = {
              abuseProbability: 0.5,
              riskLevel: 'medium',
              confidence: 0.1,
              factors: {
                ipReputation: 0.5,
                requestFrequency: 0,
                userBehavior: 0,
                isKnownBot: 0,
                isVpn: 0,
                isTor: 0,
                suspiciousPatterns: 0,
              },
            };

            span.end();
            return result;
          }

          const features = await this.extractFeatures(request);
          const prediction = this.predictAbuse(features);

          // Record prediction attributes
          span.setAttributes({
            'abuse_detector.abuse_probability': prediction.abuseProbability,
            'abuse_detector.risk_level': prediction.riskLevel,
            'abuse_detector.confidence': prediction.confidence,
            'abuse_detector.is_known_bot': features.isKnownBot,
            'abuse_detector.is_vpn': features.isVpn,
            'abuse_detector.is_tor': features.isTor,
            'abuse_detector.geo_location': features.geoLocation,
          });

          const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
          span.setAttribute('abuse_detector.duration_ms', durationMs);
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          return prediction;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          span.recordException(error as Error);
          span.end();

          // Return safe default on error
          const errorResult: AbusePrediction = {
            abuseProbability: 0.5,
            riskLevel: 'medium',
            confidence: 0,
            factors: {
              ipReputation: 0.5,
              requestFrequency: 0,
              userBehavior: 0,
              isKnownBot: 0,
              isVpn: 0,
              isTor: 0,
              suspiciousPatterns: 0,
            },
          };
          return errorResult;
        }
      },
    );
  }

  /**
   * Check if we should skip external service checks (fast-fail mode)
   * Activates when all circuit breakers are open or have high failure rates
   */
  private shouldSkipExternalChecks(): boolean {
    const cbStats = this.getCircuitBreakerStats();

    // Check if all services are unhealthy
    const allUnhealthy =
      (cbStats.ipReputation.state === CircuitState.OPEN ||
        cbStats.ipReputation.failureRate > 0.5) &&
      (cbStats.vpnCheck.state === CircuitState.OPEN || cbStats.vpnCheck.failureRate > 0.5) &&
      (cbStats.torCheck.state === CircuitState.OPEN || cbStats.torCheck.failureRate > 0.5) &&
      (cbStats.geoLocation.state === CircuitState.OPEN || cbStats.geoLocation.failureRate > 0.5);

    if (allUnhealthy) {
      console.warn('[MLAbuseDetector] All external services unhealthy, fast-fail mode enabled');
    }

    return allUnhealthy;
  }

  async checkRequestBatch(requests: HttpRequest[]): Promise<Map<string, AbusePrediction>> {
    const predictions = await Promise.all(requests.map((req) => this.checkRequest(req)));

    const resultMap = new Map<string, AbusePrediction>();
    requests.forEach((req, index) => {
      resultMap.set(req.userId || req.ip || 'unknown', predictions[index]!);
    });

    return resultMap;
  }

  private async extractFeatures(request: HttpRequest): Promise<AbuseFeatures> {
    const [ipReputation, requestFrequency, userBehavior, isKnownBot, isVpn, isTor, geoLocation] =
      await Promise.all([
        this.getIpReputation(request.ip || 'unknown'),
        this.getRequestFrequency(request.userId || request.ip || 'unknown'),
        this.getUserBehavior(request.userId || 'unknown'),
        this.isKnownBot(request.userAgent || ''),
        this.isVpn(request.ip || 'unknown'),
        this.isTor(request.ip || 'unknown'),
        this.getGeoLocation(request.ip || 'unknown'),
      ]);

    const timeOfDay = new Date(request.timestamp).getHours();
    const suspiciousPatterns = this.detectSuspiciousPatterns(request);

    return {
      ipReputation,
      requestFrequency,
      userBehavior,
      timeOfDay,
      geoLocation,
      isKnownBot,
      isVpn,
      isTor,
      suspiciousPatterns,
    };
  }

  private predictAbuse(features: AbuseFeatures): AbusePrediction {
    const weights = {
      ipReputation: 0.25,
      requestFrequency: 0.2,
      userBehavior: 0.15,
      timeOfDay: 0.05,
      geoLocation: 0.05,
      isKnownBot: 0.15,
      isVpn: 0.05,
      isTor: 0.05,
      suspiciousPatterns: 0.05,
    };

    const abuseProbability =
      features.ipReputation * weights.ipReputation +
      features.requestFrequency * weights.requestFrequency +
      features.userBehavior * weights.userBehavior +
      (features.isKnownBot ? 1 : 0) * weights.isKnownBot +
      (features.isVpn ? 0.5 : 0) * weights.isVpn +
      (features.isTor ? 0.7 : 0) * weights.isTor +
      features.suspiciousPatterns * weights.suspiciousPatterns +
      this.getTimeOfDayRisk(features.timeOfDay) * weights.timeOfDay +
      this.getGeoLocationRisk(features.geoLocation) * weights.geoLocation;

    const riskLevel = this.calculateRiskLevel(abuseProbability);
    const confidence = this.calculateConfidence(features);

    return {
      abuseProbability: Math.min(1, Math.max(0, abuseProbability)),
      riskLevel,
      confidence,
      factors: {
        ipReputation: features.ipReputation,
        requestFrequency: features.requestFrequency,
        userBehavior: features.userBehavior,
        isKnownBot: features.isKnownBot ? 1 : 0,
        isVpn: features.isVpn ? 1 : 0,
        isTor: features.isTor ? 1 : 0,
        suspiciousPatterns: features.suspiciousPatterns,
      },
    };
  }

  private calculateRiskLevel(probability: number): 'low' | 'medium' | 'high' | 'critical' {
    if (probability < 0.3) return 'low';
    if (probability < 0.5) return 'medium';
    if (probability < 0.8) return 'high';
    return 'critical';
  }

  private calculateConfidence(features: AbuseFeatures): number {
    const factors = [features.ipReputation, features.requestFrequency, features.userBehavior];

    const validFactors = factors.filter((f) => f > 0);
    if (validFactors.length === 0) return 0;

    const variance = this.calculateVariance(validFactors);
    return Math.max(0, 1 - variance);
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  private async getIpReputation(ip: string): Promise<number> {
    if (ip === 'unknown') return 0.5;

    const cached = this.ipReputationCache.get(ip);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.score;
    }

    const result = await this.ipReputationBreaker.execute(
      async () => {
        const response = await fetch(`${this.reputationServiceEndpoint}/reputation/${ip}`);
        const data = (await response.json()) as { reputation?: number };
        return data.reputation || 0.5;
      },
      0.5, // Fallback value
    );

    const score = result.success && result.data !== undefined ? result.data : 0.5;
    this.ipReputationCache.set(ip, { score, timestamp: Date.now() });

    return score;
  }

  private async getRequestFrequency(identifier: string): Promise<number> {
    const cached = this.userFrequencyCache.get(identifier);
    const now = Date.now();
    const windowMs = 60_000;

    if (!cached) {
      // Create new entry with the current request
      this.userFrequencyCache.set(identifier, { count: 1, window: [now] });
      return 0; // First request, no frequency yet
    }

    // Remove expired timestamps from window first
    while (cached.window.length > 0 && now - cached.window[0]! > windowMs) {
      cached.window.shift();
      cached.count--;
    }

    // If window is now empty after cleanup, start fresh
    if (cached.window.length === 0) {
      cached.count = 1;
      cached.window = [now];
      return 0;
    }

    // Increment count and add new timestamp
    cached.count++;
    cached.window.push(now);

    return Math.min(1, cached.count / 100);
  }

  private async getUserBehavior(userId: string): Promise<number> {
    if (userId === 'unknown') return 0.3;

    const cached = this.userFrequencyCache.get(userId);
    if (!cached) return 0.3;

    const variance = cached.count > 0 ? 1 / cached.count : 0;
    return Math.min(1, variance);
  }

  private async isKnownBot(userAgent: string): Promise<boolean> {
    if (!userAgent) return false;

    const botPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /headless/i,
      /phantom/i,
      /selenium/i,
      /puppeteer/i,
    ];

    return botPatterns.some((pattern) => pattern.test(userAgent));
  }

  private async isVpn(ip: string): Promise<boolean> {
    if (ip === 'unknown') return false;

    const result = await this.vpnCheckBreaker.execute(
      async () => {
        const response = await fetch(`${this.geoIpServiceEndpoint}/vpn/${ip}`);
        const data = (await response.json()) as { isVpn?: boolean };
        return data.isVpn || false;
      },
      false, // Fallback value
    );

    return result.success && result.data !== undefined ? result.data : false;
  }

  private async isTor(ip: string): Promise<boolean> {
    if (ip === 'unknown') return false;

    const result = await this.torCheckBreaker.execute(
      async () => {
        const response = await fetch(`${this.geoIpServiceEndpoint}/tor/${ip}`);
        const data = (await response.json()) as { isTor?: boolean };
        return data.isTor || false;
      },
      false, // Fallback value
    );

    return result.success && result.data !== undefined ? result.data : false;
  }

  private async getGeoLocation(ip: string): Promise<string> {
    if (ip === 'unknown') return 'unknown';

    const result = await this.geoLocationBreaker.execute(
      async () => {
        const response = await fetch(`${this.geoIpServiceEndpoint}/geo/${ip}`);
        const data = (await response.json()) as { country?: string; region?: string };
        return data.country || data.region || 'unknown';
      },
      'unknown', // Fallback value
    );

    return result.success && result.data !== undefined ? result.data : 'unknown';
  }

  private getTimeOfDayRisk(hour: number): number {
    if (hour >= 0 && hour < 6) return 0.6;
    if (hour >= 6 && hour < 12) return 0.3;
    if (hour >= 12 && hour < 18) return 0.2;
    return 0.4;
  }

  private getGeoLocationRisk(location: string): number {
    if (!location || location === 'unknown') {
      return 0.2;
    }

    if (this.highRiskCountries.has(location)) {
      return 0.8;
    }

    return 0.2;
  }

  private cleanupCache(): void {
    const startTime = process.hrtime.bigint();
    const now = Date.now();
    const maxExecutionTimeMs = 500; // Guardrail: max 500ms cleanup time

    let ipReputationCleaned = 0;
    let userFrequencyCleaned = 0;

    // Clean expired entries from ipReputationCache
    // Note: LRU cache enforces max size automatically, but we still clean expired entries
    for (const [key, cached] of this.ipReputationCache.entries()) {
      // Check guardrail
      const elapsed = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      if (elapsed > maxExecutionTimeMs) {
        console.warn(`[MLAbuseDetector] Cleanup aborted after ${elapsed.toFixed(0)}ms`);
        break;
      }

      // Remove expired entries
      if (now - cached.timestamp > this.cacheTTL) {
        this.ipReputationCache.delete(key);
        ipReputationCleaned++;
      }
    }

    // Clean userFrequencyCache - remove expired timestamps and empty windows
    for (const [key, cached] of this.userFrequencyCache.entries()) {
      // Check guardrail
      const elapsed = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      if (elapsed > maxExecutionTimeMs) {
        break;
      }

      // Remove expired timestamps from window
      const windowMs = 60_000;
      while (cached.window.length > 0 && now - cached.window[0]! > windowMs) {
        cached.window.shift();
        cached.count--;
      }

      // Remove entry entirely if window is empty
      if (cached.window.length === 0) {
        this.userFrequencyCache.delete(key);
        userFrequencyCleaned++;
      }
    }

    // Log cleanup metrics
    const totalCleaned = ipReputationCleaned + userFrequencyCleaned;
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    // Emit metric for cleanup duration
    metrics.abuseDetectorCleanupDurationMs.observe({ operation: 'cleanup' }, durationMs);

    if (totalCleaned > 0 || durationMs > 100) {
      console.log(
        `[MLAbuseDetector] Cleanup: ${totalCleaned} entries in ${durationMs.toFixed(2)}ms. ` +
          `IP: ${ipReputationCleaned}, User: ${userFrequencyCleaned}, ` +
          `Sizes: ${this.ipReputationCache.size}/${this.userFrequencyCache.size}`,
      );
    }
  }

  private detectSuspiciousPatterns(request: HttpRequest): number {
    let suspiciousScore = 0;

    if (request.method === 'POST' && !request.userId) {
      suspiciousScore += 0.3;
    }

    if (request.url && request.url.includes('../')) {
      suspiciousScore += 0.5;
    }

    if (request.userAgent && request.userAgent.length < 10) {
      suspiciousScore += 0.2;
    }

    return Math.min(1, suspiciousScore);
  }

  clearCache(): void {
    this.ipReputationCache.clear();
    this.userFrequencyCache.clear();
  }

  getCacheStats(): {
    ipReputation: number;
    userFrequency: number;
    maxCacheSize: number;
    cleanupIntervalActive: boolean;
    ipReputationHitRate: number;
    userFrequencyHitRate: number;
  } {
    const ipStats = this.ipReputationCache.getStats();
    const userStats = this.userFrequencyCache.getStats();

    return {
      ipReputation: ipStats.size,
      userFrequency: userStats.size,
      maxCacheSize: this.maxCacheSize,
      cleanupIntervalActive: this.cleanupInterval !== null,
      ipReputationHitRate: ipStats.hitRate,
      userFrequencyHitRate: userStats.hitRate,
    };
  }

  /**
   * Get circuit breaker statistics for all external services
   */
  getCircuitBreakerStats(): {
    ipReputation: ReturnType<CircuitBreaker<number>['getMetrics']>;
    vpnCheck: ReturnType<CircuitBreaker<boolean>['getMetrics']>;
    torCheck: ReturnType<CircuitBreaker<boolean>['getMetrics']>;
    geoLocation: ReturnType<CircuitBreaker<string>['getMetrics']>;
  } {
    return {
      ipReputation: this.ipReputationBreaker.getMetrics(),
      vpnCheck: this.vpnCheckBreaker.getMetrics(),
      torCheck: this.torCheckBreaker.getMetrics(),
      geoLocation: this.geoLocationBreaker.getMetrics(),
    };
  }

  /**
   * Check if all external services are healthy (circuit breakers closed)
   */
  areExternalServicesHealthy(): boolean {
    const stats = this.getCircuitBreakerStats();
    return (
      stats.ipReputation.state === CircuitState.CLOSED &&
      stats.vpnCheck.state === CircuitState.CLOSED &&
      stats.torCheck.state === CircuitState.CLOSED &&
      stats.geoLocation.state === CircuitState.CLOSED
    );
  }

  /**
   * Reset all circuit breakers (for testing or manual recovery)
   */
  resetCircuitBreakers(): void {
    this.ipReputationBreaker.reset();
    this.vpnCheckBreaker.reset();
    this.torCheckBreaker.reset();
    this.geoLocationBreaker.reset();
  }
}

export default MLAbuseDetector;
