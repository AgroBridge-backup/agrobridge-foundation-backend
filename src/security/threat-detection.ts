/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Core threat detection engine for AgroBridge Foundation backend
 * Provides real-time analysis of security events and correlation of threats
 */

import type { RedisClientType } from 'redis';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as promClient from 'prom-client';

/**
 * Security event severity levels
 */
export enum ThreatSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Types of security threats detected
 */
export enum ThreatType {
  BRUTE_FORCE = 'brute_force',
  XSS_ATTEMPT = 'xss_attempt',
  SQL_INJECTION = 'sql_injection',
  RATE_LIMIT_EVASION = 'rate_limit_evasion',
  DATA_EXFILTRATION = 'data_exfiltration',
  ACCOUNT_TAKEOVER = 'account_takeover',
  BOT_TRAFFIC = 'bot_traffic',
  CREDENTIAL_STUFFING = 'credential_stuffing',
  SUSPICIOUS_TRAFFIC = 'suspicious_traffic',
  ANOMALY_DETECTED = 'anomaly_detected'
}

/**
 * Security event structure
 */
export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: ThreatType;
  severity: ThreatSeverity;
  sourceIp: string;
  userId: string | undefined;
  sessionId: string | undefined;
  path: string;
  method: string;
  userAgent: string;
  details: Record<string, unknown>;
  confidence: number;
  triggeredRules: string[];
}

/**
 * Detection rule interface
 */
export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  type: ThreatType;
  severity: ThreatSeverity;
  enabled: boolean;
  conditions: RuleCondition[];
  threshold: number;
  timeWindow: number; // milliseconds
  confidence: number;
}

/**
 * Rule condition structure
 */
export interface RuleCondition {
  field: string;
  operator: 'equals' | 'contains' | 'regex' | 'gt' | 'lt' | 'exists';
  value?: unknown;
  caseSensitive?: boolean;
}

/**
 * Event context for analysis
 */
export interface EventContext {
  request: FastifyRequest;
  response?: FastifyReply;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  channels: string[];
  severityThreshold: ThreatSeverity;
  rateLimitWindow: number;
  maxAlertsPerWindow: number;
}

/**
 * Threat intelligence indicator
 */
export interface ThreatIndicator {
  type: 'ip' | 'domain' | 'hash' | 'url';
  value: string;
  category: string;
  confidence: number;
  source: string;
  lastSeen: Date;
}

/**
 * Detection statistics
 */
export interface DetectionStats {
  totalEvents: number;
  byType: Record<ThreatType, number>;
  bySeverity: Record<ThreatSeverity, number>;
  bySourceIp: Record<string, number>;
  blockedRequests: number;
  falsePositives: number;
}

// Prometheus metrics
const threatDetectionCounter = new promClient.Counter({
  name: 'security_threat_detection_total',
  help: 'Total number of security threats detected',
  labelNames: ['type', 'severity']
});

const detectionLatency = new promClient.Histogram({
  name: 'security_detection_latency_seconds',
  help: 'Threat detection latency in seconds',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1]
});

const activeThreatsGauge = new promClient.Gauge({
  name: 'security_active_threats',
  help: 'Number of currently active threats'
});

/**
 * Core threat detection engine
 */
export class ThreatDetectionEngine {
  private rules: Map<string, DetectionRule> = new Map();
  private eventQueue: SecurityEvent[] = [];
  private redis: RedisClientType;
  private readonly maxQueueSize = 10000;
  private readonly eventRetentionMs = 86400000; // 24 hours
  private stats: DetectionStats = {
    totalEvents: 0,
    byType: {} as Record<ThreatType, number>,
    bySeverity: {} as Record<ThreatSeverity, number>,
    bySourceIp: {},
    blockedRequests: 0,
    falsePositives: 0
  };

  constructor(redis: RedisClientType) {
    this.redis = redis;
    this.initializeMetrics();
    this.startEventCleanup();
  }

  /**
   * Initialize detection rules
   */
  public registerRule(rule: DetectionRule): void {
    this.rules.set(rule.id, rule);
    console.log(`[ThreatDetection] Registered rule: ${rule.name} (${rule.id})`);
  }

  /**
   * Analyze request for threats
   */
  public async analyzeRequest(context: EventContext): Promise<SecurityEvent[]> {
    const startTime = performance.now();
    const events: SecurityEvent[] = [];

    try {
      for (const rule of this.rules.values()) {
        if (!rule.enabled) continue;

        const match = await this.evaluateRule(rule, context);
        if (match.isMatch && match.confidence >= rule.confidence) {
          const event = this.createSecurityEvent(rule, context, match);
          events.push(event as SecurityEvent);
          
          // Update metrics
          threatDetectionCounter.inc({ 
            type: rule.type, 
            severity: rule.severity 
          });
        }
      }

      // Check threat intelligence
      const tiMatches = await this.checkThreatIntelligence(context);
      events.push(...(tiMatches as SecurityEvent[]));

      // Store events
      await this.storeEvents(events);

      // Record latency
      detectionLatency.observe((performance.now() - startTime) / 1000);
      activeThreatsGauge.set(this.eventQueue.length);

      return events;
    } catch (error) {
      console.error('[ThreatDetection] Analysis error:', error);
      return [];
    }
  }

  /**
   * Evaluate a single rule against request context
   */
  private async evaluateRule(
    rule: DetectionRule, 
    context: EventContext
  ): Promise<{ isMatch: boolean; confidence: number; details: Record<string, unknown> }> {
    let matchCount = 0;
    const details: Record<string, unknown> = {};

    for (const condition of rule.conditions) {
      const match = await this.evaluateCondition(condition, context);
      if (match) {
        matchCount++;
        details[condition.field] = true;
      }
    }

    const isMatch = matchCount >= rule.threshold;
    const confidence = isMatch ? rule.confidence * (matchCount / rule.conditions.length) : 0;

    return { isMatch, confidence, details };
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(
    condition: RuleCondition, 
    context: EventContext
  ): Promise<boolean> {
    const value = this.getFieldValue(condition.field, context);
    
    if (value === undefined) {
      return condition.operator === 'exists' ? false : true;
    }

    switch (condition.operator) {
      case 'equals':
        return condition.caseSensitive 
          ? value === condition.value
          : String(value).toLowerCase() === String(condition.value).toLowerCase();
      
      case 'contains':
        return String(value).toLowerCase().includes(String(condition.value).toLowerCase());
      
      case 'regex':
        if (condition.value) {
          const regex = new RegExp(String(condition.value), condition.caseSensitive ? '' : 'i');
          return regex.test(String(value));
        }
        return false;
      
      case 'gt':
        return Number(value) > Number(condition.value);
      
      case 'lt':
        return Number(value) < Number(condition.value);
      
      case 'exists':
        return value !== undefined;
      
      default:
        return false;
    }
  }

  /**
   * Get field value from context
   */
  private getFieldValue(field: string, context: EventContext): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Create security event from rule match
   */
  private createSecurityEvent(
    rule: DetectionRule,
    context: EventContext,
    match: { confidence: number; details: Record<string, unknown> }
  ): SecurityEvent {
    const request = context.request;
    
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: rule.type,
      severity: rule.severity,
      sourceIp: request.ip || 'unknown',
      userId: (request.user as { id?: string })?.id,
      sessionId: undefined,
      path: request.url,
      method: request.method,
      userAgent: request.headers['user-agent'] || 'unknown',
      details: {
        ruleId: rule.id,
        ruleName: rule.name,
        ...match.details,
        body: context.body,
        query: context.query
      },
      confidence: match.confidence,
      triggeredRules: [rule.id]
    };
  }

  /**
   * Check threat intelligence feeds
   */
  private async checkThreatIntelligence(context: EventContext): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    const ip = context.request.ip;

    if (!ip) return events;

    // Check if IP is in known bad list
    const isBadIp = await this.redis.sIsMember('threat:intelligence:bad_ips', ip);
    if (isBadIp) {
      const tiEvent: SecurityEvent = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: ThreatType.SUSPICIOUS_TRAFFIC,
        severity: ThreatSeverity.HIGH,
        sourceIp: ip,
        userId: (context.request.user as { id?: string })?.id,
        sessionId: undefined,
        path: context.request.url,
        method: context.request.method,
        userAgent: context.request.headers['user-agent'] || 'unknown',
        details: {
          reason: 'IP found in threat intelligence feed',
          source: 'threat_intelligence'
        },
        confidence: 0.95,
        triggeredRules: ['threat_intelligence_check']
      };
      events.push(tiEvent);
    }

    return events;
  }

  /**
   * Store security events
   */
  private async storeEvents(events: SecurityEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Add to memory queue
    this.eventQueue.push(...events);
    if (this.eventQueue.length > this.maxQueueSize) {
      this.eventQueue = this.eventQueue.slice(-this.maxQueueSize);
    }

    // Update statistics
    events.forEach(event => {
      this.stats.totalEvents++;
      this.stats.byType[event.type] = (this.stats.byType[event.type] || 0) + 1;
      this.stats.bySeverity[event.severity] = (this.stats.bySeverity[event.severity] || 0) + 1;
      this.stats.bySourceIp[event.sourceIp] = (this.stats.bySourceIp[event.sourceIp] || 0) + 1;
    });

    // Store in Redis for persistence
    for (const event of events) {
      const key = `security:event:${event.timestamp.toISOString().split('T')[0]}:${event.id}`;
      await this.redis.setEx(key, 86400, JSON.stringify(event));
      
      // Add to time-series index
      await this.redis.zAdd('security:events:timeline', {
        score: event.timestamp.getTime(),
        value: event.id
      });
      
      // Add to type index
      await this.redis.sAdd(`security:events:type:${event.type}`, event.id);
      
      // Add to IP index
      await this.redis.sAdd(`security:events:ip:${event.sourceIp}`, event.id);
    }
  }

  /**
   * Get events for a time range
   */
  public async getEvents(
    startTime: Date,
    endTime: Date,
    options?: {
      type?: ThreatType;
      severity?: ThreatSeverity;
      sourceIp?: string;
    }
  ): Promise<SecurityEvent[]> {
    const events: SecurityEvent[] = [];
    
    // Query from Redis
    const eventIds = await this.redis.zRangeByScore(
      'security:events:timeline',
      startTime.getTime(),
      endTime.getTime()
    );

    for (const id of eventIds) {
      if (!id) continue;
      const idStr = String(id);
      // Find the event key
      const keys = await this.redis.keys(`security:event:*:${idStr}`);
      if (keys.length > 0 && keys[0]) {
        const data = await this.redis.get(keys[0]);
        if (data) {
          const event = JSON.parse(data) as SecurityEvent;
          
          // Apply filters
          if (options?.type && event.type !== options.type) continue;
          if (options?.severity && event.severity !== options.severity) continue;
          if (options?.sourceIp && event.sourceIp !== options.sourceIp) continue;
          
          events.push(event);
        }
      }
    }

    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get detection statistics
   */
  public getStats(): DetectionStats {
    return { ...this.stats };
  }

  /**
   * Get current threat summary
   */
  public async getThreatSummary(): Promise<{
    activeThreats: number;
    highSeverityCount: number;
    blockedIps: number;
    topThreats: Array<{ type: ThreatType; count: number }>;
  }> {
    const now = Date.now();
    const fiveMinutesAgo = now - 300000;
    
    const recentEvents = this.eventQueue.filter(
      e => e.timestamp.getTime() > fiveMinutesAgo
    );

    const highSeverityCount = recentEvents.filter(
      e => e.severity === ThreatSeverity.HIGH || e.severity === ThreatSeverity.CRITICAL
    ).length;

    const typeCount: Record<string, number> = {};
    recentEvents.forEach(e => {
      typeCount[e.type] = (typeCount[e.type] || 0) + 1;
    });

    const topThreats = Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type: type as ThreatType, count }));

    const blockedIps = await this.redis.sCard('security:blocked_ips');

    return {
      activeThreats: recentEvents.length,
      highSeverityCount,
      blockedIps,
      topThreats
    };
  }

  /**
   * Mark event as false positive
   */
  public async markFalsePositive(eventId: string): Promise<void> {
    await this.redis.sAdd('security:false_positives', eventId);
    this.stats.falsePositives++;
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializeMetrics(): void {
    // Initialize gauges with zero values
    Object.values(ThreatType).forEach(type => {
      Object.values(ThreatSeverity).forEach(severity => {
        threatDetectionCounter.inc({ type, severity }, 0);
      });
    });
  }

  /**
   * Start event cleanup job
   */
  private startEventCleanup(): void {
    setInterval(() => {
      const cutoff = Date.now() - this.eventRetentionMs;
      this.eventQueue = this.eventQueue.filter(
        e => e.timestamp.getTime() > cutoff
      );
    }, 3600000); // Run every hour
  }
}

// Singleton instance
let threatDetectionEngine: ThreatDetectionEngine | null = null;

export function initializeThreatDetection(redis: RedisClientType): ThreatDetectionEngine {
  if (!threatDetectionEngine) {
    threatDetectionEngine = new ThreatDetectionEngine(redis);
  }
  return threatDetectionEngine;
}

export function getThreatDetectionEngine(): ThreatDetectionEngine | null {
  return threatDetectionEngine;
}
