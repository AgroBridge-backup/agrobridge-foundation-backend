/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Anomaly detection system for security events
 * Uses statistical analysis and machine learning for threat detection
 */

import type { RedisClientType } from 'redis';
import { FastifyRequest } from 'fastify';

/**
 * Anomaly types detected
 */
export enum AnomalyType {
  TRAFFIC_VOLUME = 'traffic_volume',
  REQUEST_RATE = 'request_rate',
  PAYLOAD_SIZE = 'payload_size',
  ERROR_RATE = 'error_rate',
  GEO_LOCATION = 'geo_location',
  TIME_PATTERN = 'time_pattern',
  USER_BEHAVIOR = 'user_behavior',
  ENDPOINT_ACCESS = 'endpoint_access'
}

/**
 * Anomaly severity levels
 */
export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Baseline profile for an entity (IP, user, etc.)
 */
interface BaselineProfile {
  entityId: string;
  entityType: 'ip' | 'user' | 'session';
  createdAt: Date;
  updatedAt: Date;
  
  // Request patterns
  avgRequestsPerMinute: number;
  stdDevRequestsPerMinute: number;
  peakRequestsPerMinute: number;
  
  // Timing patterns
  avgTimeBetweenRequests: number;
  stdDevTimeBetweenRequests: number;
  
  // Payload patterns
  avgPayloadSize: number;
  stdDevPayloadSize: number;
  maxPayloadSize: number;
  
  // Error patterns
  avgErrorRate: number;
  stdDevErrorRate: number;
  
  // Endpoint access patterns
  preferredEndpoints: Array<{ endpoint: string; frequency: number }>;
  
  // Geographic patterns
  usualLocations: Array<{ country: string; city: string; frequency: number }>;
  
  // Time patterns
  activeHours: number[]; // Hours of day (0-23)
  activeDays: number[]; // Days of week (0-6)
  
  // User agent patterns
  usualUserAgents: Array<{ userAgent: string; frequency: number }>;
}

/**
 * Detected anomaly
 */
export interface Anomaly {
  id: string;
  timestamp: Date;
  type: AnomalyType;
  severity: AnomalySeverity;
  entityId: string;
  entityType: 'ip' | 'user' | 'session';
  currentValue: number;
  expectedValue: number;
  deviation: number; // Standard deviations from mean
  confidence: number;
  details: Record<string, unknown>;
}

/**
 * Statistical window for analysis
 */
interface AnalysisWindow {
  startTime: Date;
  endTime: Date;
  requests: RequestMetrics[];
}

/**
 * Request metrics for analysis
 */
interface RequestMetrics {
  timestamp: Date;
  path: string;
  method: string;
  statusCode: number;
  payloadSize: number;
  responseTime: number;
  headers: Record<string, string>;
}

/**
 * Configuration for anomaly detection
 */
interface AnomalyConfig {
  // Time windows (in milliseconds)
  shortWindowMs: number;      // 1 minute
  mediumWindowMs: number;     // 5 minutes
  longWindowMs: number;       // 1 hour
  
  // Thresholds (in standard deviations)
  lowThreshold: number;       // 2 sigma
  mediumThreshold: number;    // 3 sigma
  highThreshold: number;      // 4 sigma
  criticalThreshold: number;  // 5 sigma
  
  // Minimum samples required for baseline
  minSamplesForBaseline: number;
  
  // Update interval for baselines
  baselineUpdateIntervalMs: number;
  
  // Retention period
  dataRetentionHours: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AnomalyConfig = {
  shortWindowMs: 60000,       // 1 minute
  mediumWindowMs: 300000,     // 5 minutes
  longWindowMs: 3600000,      // 1 hour
  lowThreshold: 2,
  mediumThreshold: 3,
  highThreshold: 4,
  criticalThreshold: 5,
  minSamplesForBaseline: 10,
  baselineUpdateIntervalMs: 3600000, // 1 hour
  dataRetentionHours: 24
};

/**
 * Anomaly detection engine
 */
export class AnomalyDetector {
  private redis: RedisClientType;
  private config: AnomalyConfig;
  private baselines: Map<string, BaselineProfile> = new Map();
  private lastBaselineUpdate: Map<string, Date> = new Map();

  constructor(redis: RedisClientType, config: Partial<AnomalyConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startBaselineMaintenance();
  }

  /**
   * Analyze request for anomalies
   */
  public async analyzeRequest(
    request: FastifyRequest,
    responseTime: number,
    statusCode: number
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];
    const entityId = request.ip || 'unknown';
    const entityType = 'ip';
    const timestamp = new Date();

    try {
      // Store request metrics
      await this.storeRequestMetrics(request, responseTime, statusCode);

      // Get or create baseline
      const baseline = await this.getOrCreateBaseline(entityId, entityType);
      if (!baseline) return anomalies;

      // Check various anomaly types
      const checks = await Promise.all([
        this.checkTrafficVolumeAnomaly(entityId, entityType, baseline),
        this.checkRequestRateAnomaly(entityId, entityType, baseline),
        this.checkPayloadSizeAnomaly(request, baseline),
        this.checkErrorRateAnomaly(entityId, entityType, baseline),
        this.checkGeolocationAnomaly(request, baseline),
        this.checkTimePatternAnomaly(timestamp, baseline),
        this.checkEndpointAccessAnomaly(request, baseline)
      ]);

      // Filter out null results
      const detectedAnomalies = checks.filter((a): a is Anomaly => a !== null);
      anomalies.push(...detectedAnomalies);

      // Store anomalies
      for (const anomaly of detectedAnomalies) {
        await this.storeAnomaly(anomaly);
      }

      return anomalies;
    } catch (error) {
      console.error('[AnomalyDetector] Analysis error:', error);
      return anomalies;
    }
  }

  /**
   * Check for traffic volume anomalies
   */
  private async checkTrafficVolumeAnomaly(
    entityId: string,
    entityType: 'ip' | 'user' | 'session',
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const currentRate = await this.getCurrentRequestRate(entityId, this.config.shortWindowMs);
    const deviation = this.calculateDeviation(currentRate, baseline.avgRequestsPerMinute, baseline.stdDevRequestsPerMinute);
    
    if (Math.abs(deviation) < this.config.lowThreshold) return null;

    return this.createAnomaly(
      AnomalyType.TRAFFIC_VOLUME,
      entityId,
      entityType,
      currentRate,
      baseline.avgRequestsPerMinute,
      deviation
    );
  }

  /**
   * Check for request rate anomalies
   */
  private async checkRequestRateAnomaly(
    entityId: string,
    entityType: 'ip' | 'user' | 'session',
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const timeBetweenRequests = await this.getTimeBetweenRequests(entityId);
    const deviation = this.calculateDeviation(
      timeBetweenRequests,
      baseline.avgTimeBetweenRequests,
      baseline.stdDevTimeBetweenRequests
    );
    
    if (Math.abs(deviation) < this.config.lowThreshold) return null;

    return this.createAnomaly(
      AnomalyType.REQUEST_RATE,
      entityId,
      entityType,
      timeBetweenRequests,
      baseline.avgTimeBetweenRequests,
      deviation
    );
  }

  /**
   * Check for payload size anomalies
   */
  private async checkPayloadSizeAnomaly(
    request: FastifyRequest,
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const payloadSize = parseInt(request.headers['content-length'] || '0', 10);
    if (payloadSize === 0) return null;

    const deviation = this.calculateDeviation(payloadSize, baseline.avgPayloadSize, baseline.stdDevPayloadSize);
    
    if (Math.abs(deviation) < this.config.mediumThreshold) return null;

    return this.createAnomaly(
      AnomalyType.PAYLOAD_SIZE,
      request.ip || 'unknown',
      'ip',
      payloadSize,
      baseline.avgPayloadSize,
      deviation,
      { path: request.url }
    );
  }

  /**
   * Check for error rate anomalies
   */
  private async checkErrorRateAnomaly(
    entityId: string,
    entityType: 'ip' | 'user' | 'session',
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const currentErrorRate = await this.getCurrentErrorRate(entityId, this.config.mediumWindowMs);
    const deviation = this.calculateDeviation(currentErrorRate, baseline.avgErrorRate, baseline.stdDevErrorRate);
    
    if (Math.abs(deviation) < this.config.mediumThreshold) return null;

    return this.createAnomaly(
      AnomalyType.ERROR_RATE,
      entityId,
      entityType,
      currentErrorRate,
      baseline.avgErrorRate,
      deviation
    );
  }

  /**
   * Check for geolocation anomalies
   */
  private async checkGeolocationAnomaly(
    request: FastifyRequest,
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    // Extract country/city from headers (set by reverse proxy or CDN)
    const country = request.headers['cf-ipcountry'] as string || 
                    request.headers['x-country-code'] as string || 
                    'unknown';
    
    const city = request.headers['cf-ipcity'] as string || 
                 request.headers['x-city'] as string || 
                 'unknown';

    // Check if this location is in usual locations
    const isKnownLocation = baseline.usualLocations.some(
      loc => loc.country === country && loc.city === city
    );

    if (isKnownLocation) return null;

    // New location detected
    return this.createAnomaly(
      AnomalyType.GEO_LOCATION,
      request.ip || 'unknown',
      'ip',
      1,
      0,
      5, // High deviation for new location
      { country, city }
    );
  }

  /**
   * Check for time pattern anomalies
   */
  private async checkTimePatternAnomaly(
    timestamp: Date,
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const hour = timestamp.getHours();
    const day = timestamp.getDay();

    const isUsualHour = baseline.activeHours.includes(hour);
    const isUsualDay = baseline.activeDays.includes(day);

    if (isUsualHour && isUsualDay) return null;

    return this.createAnomaly(
      AnomalyType.TIME_PATTERN,
      baseline.entityId,
      baseline.entityType,
      hour,
      baseline.activeHours[0] || 0,
      isUsualHour ? 0 : 3,
      { unusualHour: !isUsualHour, unusualDay: !isUsualDay }
    );
  }

  /**
   * Check for unusual endpoint access
   */
  private async checkEndpointAccessAnomaly(
    request: FastifyRequest,
    baseline: BaselineProfile
  ): Promise<Anomaly | null> {
    const endpoint = `${request.method} ${request.url.split('?')[0]}`;
    
    const isPreferredEndpoint = baseline.preferredEndpoints.some(
      pref => pref.endpoint === endpoint
    );

    if (isPreferredEndpoint) return null;

    // Unusual endpoint access
    return this.createAnomaly(
      AnomalyType.ENDPOINT_ACCESS,
      request.ip || 'unknown',
      'ip',
      1,
      0,
      2,
      { endpoint }
    );
  }

  /**
   * Create anomaly object
   */
  private createAnomaly(
    type: AnomalyType,
    entityId: string,
    entityType: 'ip' | 'user' | 'session',
    currentValue: number,
    expectedValue: number,
    deviation: number,
    details: Record<string, unknown> = {}
  ): Anomaly {
    const severity = this.calculateSeverity(deviation);
    const confidence = Math.min(Math.abs(deviation) / 5, 1);

    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      severity,
      entityId,
      entityType,
      currentValue,
      expectedValue,
      deviation,
      confidence,
      details
    };
  }

  /**
   * Calculate severity based on deviation
   */
  private calculateSeverity(deviation: number): AnomalySeverity {
    const absDeviation = Math.abs(deviation);
    
    if (absDeviation >= this.config.criticalThreshold) return AnomalySeverity.CRITICAL;
    if (absDeviation >= this.config.highThreshold) return AnomalySeverity.HIGH;
    if (absDeviation >= this.config.mediumThreshold) return AnomalySeverity.MEDIUM;
    return AnomalySeverity.LOW;
  }

  /**
   * Calculate standard deviation from mean
   */
  private calculateDeviation(value: number, mean: number, stdDev: number): number {
    if (stdDev === 0) return value > mean ? 5 : 0;
    return (value - mean) / stdDev;
  }

  /**
   * Get or create baseline profile
   */
  private async getOrCreateBaseline(
    entityId: string,
    entityType: 'ip' | 'user' | 'session'
  ): Promise<BaselineProfile | null> {
    const key = `anomaly:baseline:${entityType}:${entityId}`;
    
    // Check cache
    const cached = this.baselines.get(key);
    if (cached) return cached;

    // Check Redis
    const data = await this.redis.get(key);
    if (data) {
      const profile = JSON.parse(data) as BaselineProfile;
      this.baselines.set(key, profile);
      return profile;
    }

    // Build baseline from historical data
    const profile = await this.buildBaseline(entityId, entityType);
    if (!profile) return null;

    // Store baseline
    await this.redis.setEx(key, 86400, JSON.stringify(profile));
    this.baselines.set(key, profile);
    this.lastBaselineUpdate.set(key, new Date());

    return profile;
  }

  /**
   * Build baseline from historical data
   */
  private async buildBaseline(
    entityId: string,
    entityType: 'ip' | 'user' | 'session'
  ): Promise<BaselineProfile | null> {
    // Get historical requests from Redis
    const requests = await this.getHistoricalRequests(entityId, this.config.longWindowMs);
    
    if (requests.length < this.config.minSamplesForBaseline) {
      return null; // Not enough data
    }

    // Calculate statistics
    const requestRates = this.calculateRequestRates(requests);
    const timesBetween = this.calculateTimesBetweenRequests(requests);
    const payloadSizes = requests.map(r => r.payloadSize).filter(s => s > 0);
    const errorRates = this.calculateErrorRates(requests);

    const profile: BaselineProfile = {
      entityId,
      entityType,
      createdAt: new Date(),
      updatedAt: new Date(),
      
      avgRequestsPerMinute: this.mean(requestRates),
      stdDevRequestsPerMinute: this.stdDev(requestRates),
      peakRequestsPerMinute: Math.max(...requestRates, 0),
      
      avgTimeBetweenRequests: this.mean(timesBetween),
      stdDevTimeBetweenRequests: this.stdDev(timesBetween),
      
      avgPayloadSize: this.mean(payloadSizes),
      stdDevPayloadSize: this.stdDev(payloadSizes),
      maxPayloadSize: Math.max(...payloadSizes, 0),
      
      avgErrorRate: this.mean(errorRates),
      stdDevErrorRate: this.stdDev(errorRates),
      
      preferredEndpoints: this.calculateEndpointFrequencies(requests),
      usualLocations: this.calculateLocationFrequencies(requests),
      activeHours: this.calculateActiveHours(requests),
      activeDays: this.calculateActiveDays(requests),
      usualUserAgents: this.calculateUserAgentFrequencies(requests)
    };

    return profile;
  }

  /**
   * Store request metrics
   */
  private async storeRequestMetrics(
    request: FastifyRequest,
    responseTime: number,
    statusCode: number
  ): Promise<void> {
    const entityId = request.ip || 'unknown';
    const timestamp = Date.now();
    const metrics: RequestMetrics = {
      timestamp: new Date(timestamp),
      path: request.url,
      method: request.method,
      statusCode,
      payloadSize: parseInt(request.headers['content-length'] || '0', 10),
      responseTime,
      headers: {
        'user-agent': request.headers['user-agent'] || 'unknown',
        'cf-ipcountry': request.headers['cf-ipcountry'] as string || 'unknown',
        'cf-ipcity': request.headers['cf-ipcity'] as string || 'unknown'
      }
    };

    const key = `anomaly:metrics:${entityId}:${timestamp}`;
    await this.redis.setEx(key, this.config.dataRetentionHours * 3600, JSON.stringify(metrics));
  }

  /**
   * Store anomaly
   */
  private async storeAnomaly(anomaly: Anomaly): Promise<void> {
    const key = `anomaly:detected:${anomaly.timestamp.toISOString().split('T')[0]}:${anomaly.id}`;
    await this.redis.setEx(key, 86400, JSON.stringify(anomaly));
    
    // Add to indices
    await this.redis.zAdd('anomaly:timeline', anomaly.timestamp.getTime(), anomaly.id);
    await this.redis.sAdd(`anomaly:type:${anomaly.type}`, anomaly.id);
    await this.redis.sAdd(`anomaly:entity:${anomaly.entityId}`, anomaly.id);
  }

  /**
   * Get current request rate
   */
  private async getCurrentRequestRate(entityId: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const keys = await this.redis.keys(`anomaly:metrics:${entityId}:*`);
    const requestsInWindow = keys.filter(key => {
      const timestamp = parseInt(key.split(':').pop() || '0', 10);
      return timestamp >= windowStart && timestamp <= now;
    });

    return (requestsInWindow.length / windowMs) * 60000; // Per minute
  }

  /**
   * Get time between requests
   */
  private async getTimeBetweenRequests(entityId: string): Promise<number> {
    const keys = await this.redis.keys(`anomaly:metrics:${entityId}:*`);
    if (keys.length < 2) return 0;

    const timestamps = keys
      .map(key => parseInt(key.split(':').pop() || '0', 10))
      .sort((a, b) => a - b);

    const lastTwo = timestamps.slice(-2);
    return lastTwo[1] - lastTwo[0];
  }

  /**
   * Get current error rate
   */
  private async getCurrentErrorRate(entityId: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const keys = await this.redis.keys(`anomaly:metrics:${entityId}:*`);
    let total = 0;
    let errors = 0;

    for (const key of keys) {
      const timestamp = parseInt(key.split(':').pop() || '0', 10);
      if (timestamp >= windowStart && timestamp <= now) {
        const data = await this.redis.get(key);
        if (data) {
          const metrics = JSON.parse(data) as RequestMetrics;
          total++;
          if (metrics.statusCode >= 400) errors++;
        }
      }
    }

    return total > 0 ? errors / total : 0;
  }

  /**
   * Get historical requests
   */
  private async getHistoricalRequests(
    entityId: string,
    windowMs: number
  ): Promise<RequestMetrics[]> {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const keys = await this.redis.keys(`anomaly:metrics:${entityId}:*`);
    const requests: RequestMetrics[] = [];

    for (const key of keys) {
      const timestamp = parseInt(key.split(':').pop() || '0', 10);
      if (timestamp >= windowStart && timestamp <= now) {
        const data = await this.redis.get(key);
        if (data) {
          requests.push(JSON.parse(data) as RequestMetrics);
        }
      }
    }

    return requests.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Statistical helper methods
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const m = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateRequestRates(requests: RequestMetrics[]): number[] {
    // Group by minute and count
    const byMinute: Record<number, number> = {};
    requests.forEach(r => {
      const minute = Math.floor(r.timestamp.getTime() / 60000);
      byMinute[minute] = (byMinute[minute] || 0) + 1;
    });
    return Object.values(byMinute);
  }

  private calculateTimesBetweenRequests(requests: RequestMetrics[]): number[] {
    const times: number[] = [];
    for (let i = 1; i < requests.length; i++) {
      times.push(requests[i].timestamp.getTime() - requests[i - 1].timestamp.getTime());
    }
    return times;
  }

  private calculateErrorRates(requests: RequestMetrics[]): number[] {
    // Group by 5-minute windows
    const byWindow: Record<number, { total: number; errors: number }> = {};
    requests.forEach(r => {
      const window = Math.floor(r.timestamp.getTime() / 300000);
      if (!byWindow[window]) byWindow[window] = { total: 0, errors: 0 };
      byWindow[window].total++;
      if (r.statusCode >= 400) byWindow[window].errors++;
    });
    return Object.values(byWindow).map(w => w.total > 0 ? w.errors / w.total : 0);
  }

  private calculateEndpointFrequencies(requests: RequestMetrics[]): Array<{ endpoint: string; frequency: number }> {
    const frequencies: Record<string, number> = {};
    requests.forEach(r => {
      const endpoint = `${r.method} ${r.path.split('?')[0]}`;
      frequencies[endpoint] = (frequencies[endpoint] || 0) + 1;
    });
    return Object.entries(frequencies)
      .map(([endpoint, frequency]) => ({ endpoint, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
  }

  private calculateLocationFrequencies(requests: RequestMetrics[]): Array<{ country: string; city: string; frequency: number }> {
    const frequencies: Record<string, { country: string; city: string; frequency: number }> = {};
    requests.forEach(r => {
      const country = r.headers['cf-ipcountry'] || 'unknown';
      const city = r.headers['cf-ipcity'] || 'unknown';
      const key = `${country}:${city}`;
      if (!frequencies[key]) {
        frequencies[key] = { country, city, frequency: 0 };
      }
      frequencies[key].frequency++;
    });
    return Object.values(frequencies).sort((a, b) => b.frequency - a.frequency).slice(0, 5);
  }

  private calculateActiveHours(requests: RequestMetrics[]): number[] {
    const hourCounts: Record<number, number> = {};
    requests.forEach(r => {
      const hour = r.timestamp.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const avg = Object.values(hourCounts).reduce((a, b) => a + b, 0) / 24;
    return Object.entries(hourCounts)
      .filter(([, count]) => count > avg)
      .map(([hour]) => parseInt(hour, 10));
  }

  private calculateActiveDays(requests: RequestMetrics[]): number[] {
    const dayCounts: Record<number, number> = {};
    requests.forEach(r => {
      const day = r.timestamp.getDay();
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    return Object.entries(dayCounts)
      .filter(([, count]) => count > 0)
      .map(([day]) => parseInt(day, 10));
  }

  private calculateUserAgentFrequencies(requests: RequestMetrics[]): Array<{ userAgent: string; frequency: number }> {
    const frequencies: Record<string, number> = {};
    requests.forEach(r => {
      const ua = r.headers['user-agent'] || 'unknown';
      frequencies[ua] = (frequencies[ua] || 0) + 1;
    });
    return Object.entries(frequencies)
      .map(([userAgent, frequency]) => ({ userAgent, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
  }

  /**
   * Start baseline maintenance job
   */
  private startBaselineMaintenance(): void {
    setInterval(() => {
      this.baselines.clear();
    }, this.config.baselineUpdateIntervalMs);
  }

  /**
   * Get recent anomalies
   */
  public async getRecentAnomalies(
    limit: number = 100,
    options?: {
      type?: AnomalyType;
      severity?: AnomalySeverity;
      entityId?: string;
    }
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];
    
    let ids: string[] = [];
    if (options?.entityId) {
      ids = await this.redis.sMembers(`anomaly:entity:${options.entityId}`);
    } else if (options?.type) {
      ids = await this.redis.sMembers(`anomaly:type:${options.type}`);
    } else {
      ids = await this.redis.zRevRange('anomaly:timeline', 0, limit - 1);
    }

    for (const id of ids.slice(0, limit)) {
      const keys = await this.redis.keys(`anomaly:detected:*:${id}`);
      if (keys.length > 0) {
        const data = await this.redis.get(keys[0]);
        if (data) {
          const anomaly = JSON.parse(data) as Anomaly;
          if (options?.severity && anomaly.severity !== options.severity) continue;
          anomalies.push(anomaly);
        }
      }
    }

    return anomalies.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}

// Singleton instance
let anomalyDetector: AnomalyDetector | null = null;

export function initializeAnomalyDetector(redis: RedisClientType): AnomalyDetector {
  if (!anomalyDetector) {
    anomalyDetector = new AnomalyDetector(redis);
  }
  return anomalyDetector;
}

export function getAnomalyDetector(): AnomalyDetector | null {
  return anomalyDetector;
}
