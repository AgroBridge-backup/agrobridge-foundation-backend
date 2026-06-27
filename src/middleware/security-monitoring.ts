/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Security monitoring middleware for Fastify
 * Integrates threat detection, anomaly detection, alerting, and auto-response
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getRedisClient } from '../cache/redis-client.js';
import { loadEnv } from '../config/env.js';
import {
  initializeThreatDetection,
  ThreatDetectionEngine,
  EventContext,
  SecurityEvent,
  ThreatSeverity,
  ThreatType
} from '../security/threat-detection.js';
import { initializeAnomalyDetector, AnomalyDetector } from '../security/anomaly-detector.js';
import { initializeAlerting, SecurityAlerting, AlertChannel } from '../security/alerting.js';
import { initializeAutoResponse, AutoResponseSystem, ResponseAction } from '../security/auto-response.js';
import { THREAT_DETECTION_RULES } from '../security/threat-rules.js';

// Module instances
let threatEngine: ThreatDetectionEngine | null = null;
let anomalyDetector: AnomalyDetector | null = null;
let alerting: SecurityAlerting | null = null;
let autoResponse: AutoResponseSystem | null = null;
let isInitialized = false;

/**
 * Initialize security monitoring system
 */
export async function initializeSecurityMonitoring(): Promise<void> {
  if (isInitialized) return;

  const redis = getRedisClient(loadEnv());
  if (!redis) {
    console.warn('[SecurityMonitoring] Redis not available, security monitoring disabled');
    return;
  }

  // Initialize components
  threatEngine = initializeThreatDetection(redis);
  anomalyDetector = initializeAnomalyDetector(redis);
  alerting = initializeAlerting();
  autoResponse = initializeAutoResponse(redis);

  // Register threat detection rules
  for (const rule of THREAT_DETECTION_RULES) {
    threatEngine.registerRule(rule);
  }

  // Configure alerting channels from environment
  configureAlertingChannels();

  // Configure auto-response actions
  configureAutoResponses();

  isInitialized = true;
  console.log('[SecurityMonitoring] Security monitoring initialized successfully');
}

/**
 * Configure alerting channels from environment variables
 */
function configureAlertingChannels(): void {
  if (!alerting) return;

  // Console logging (always enabled for development)
  alerting.configureChannel({
    channel: AlertChannel.CONSOLE,
    enabled: true,
    severityThreshold: ThreatSeverity.LOW,
    rateLimitWindowMs: 60000,
    maxAlertsPerWindow: 1000,
    config: {}
  });

  // Slack alerts
  if (process.env.SLACK_WEBHOOK_URL) {
    alerting.configureChannel({
      channel: AlertChannel.SLACK,
      enabled: true,
      severityThreshold: ThreatSeverity.HIGH,
      rateLimitWindowMs: 300000,
      maxAlertsPerWindow: 50,
      config: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        channel: process.env.SLACK_CHANNEL || '#security-alerts',
        username: 'AgroBridge Security',
        iconEmoji: ':shield:'
      }
    });
  }

  // Email alerts
  if (process.env.SMTP_HOST) {
    alerting.configureChannel({
      channel: AlertChannel.EMAIL,
      enabled: true,
      severityThreshold: ThreatSeverity.MEDIUM,
      rateLimitWindowMs: 600000,
      maxAlertsPerWindow: 10,
      config: {
        smtpHost: process.env.SMTP_HOST,
        smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
        username: process.env.SMTP_USER || '',
        password: process.env.SMTP_PASS || '',
        from: process.env.ALERT_FROM_EMAIL || 'security@agrobridge.foundation',
        to: (process.env.ALERT_TO_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean),
        secure: process.env.SMTP_SECURE === 'true'
      }
    });
  }

  // PagerDuty alerts for critical
  if (process.env.PAGERDUTY_INTEGRATION_KEY) {
    alerting.configureChannel({
      channel: AlertChannel.PAGERDUTY,
      enabled: true,
      severityThreshold: ThreatSeverity.CRITICAL,
      rateLimitWindowMs: 60000,
      maxAlertsPerWindow: 5,
      config: {
        integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY,
        serviceId: process.env.PAGERDUTY_SERVICE_ID || '',
        urgency: 'high'
      }
    });
  }

  // Webhook for SIEM integration
  if (process.env.SIEM_WEBHOOK_URL) {
    alerting.configureChannel({
      channel: AlertChannel.WEBHOOK,
      enabled: true,
      severityThreshold: ThreatSeverity.LOW,
      rateLimitWindowMs: 60000,
      maxAlertsPerWindow: 1000,
      config: {
        url: process.env.SIEM_WEBHOOK_URL,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SIEM_WEBHOOK_TOKEN || ''}`,
          'X-Source': 'agrobridge-security'
        },
        timeout: 5000
      }
    });
  }
}

/**
 * Configure auto-response actions
 */
function configureAutoResponses(): void {
  if (!autoResponse) return;

  // Block IPs for brute force attacks
  autoResponse.configureAction({
    action: ResponseAction.BLOCK_IP,
    enabled: true,
    severityThreshold: ThreatSeverity.CRITICAL,
    duration: 3600000, // 1 hour
    cooldown: 300000 // 5 minutes
  });

  // Require CAPTCHA for suspicious activity
  autoResponse.configureAction({
    action: ResponseAction.REQUIRE_CAPTCHA,
    enabled: true,
    severityThreshold: ThreatSeverity.HIGH,
    duration: 1800000, // 30 minutes
    cooldown: 60000 // 1 minute
  });

  // Enable enhanced logging for investigation
  autoResponse.configureAction({
    action: ResponseAction.ENABLE_ENHANCED_LOGGING,
    enabled: true,
    severityThreshold: ThreatSeverity.MEDIUM,
    duration: 3600000, // 1 hour
    cooldown: 0
  });

  // Throttle requests
  autoResponse.configureAction({
    action: ResponseAction.THROTTLE_REQUESTS,
    enabled: true,
    severityThreshold: ThreatSeverity.HIGH,
    duration: 1800000, // 30 minutes
    cooldown: 60000 // 1 minute
  });
}

/**
 * Security monitoring middleware - onRequest hook
 */
export async function securityMonitoringOnRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): Promise<void> {
  if (!isInitialized) {
    done();
    return;
  }

  try {
    // Add security context to request
    (req as FastifyRequest & { securityContext: SecurityContext }).securityContext = {
      requestStartTime: Date.now(),
      requestId: req.id,
      threatScore: 0,
      detectedThreats: [],
      requiresCaptcha: false,
      enhancedLogging: false
    };

    // Check if IP is blocked
    if (autoResponse && req.ip) {
      const isBlocked = await autoResponse.isIPBlocked(req.ip);
      if (isBlocked) {
        reply.code(403).send({
          error: 'Access Denied',
          message: 'Your IP has been blocked due to suspicious activity'
        });
        return;
      }

      // Check if CAPTCHA required
      const captchaRequired = await autoResponse.isCaptchaRequired(req.ip);
      if (captchaRequired) {
        (req as FastifyRequest & { securityContext: SecurityContext }).securityContext.requiresCaptcha = true;
      }
    }

    done();
  } catch (error) {
    console.error('[SecurityMonitoring] Error in onRequest hook:', error);
    done();
  }
}

/**
 * Security monitoring middleware - onResponse hook
 */
export async function securityMonitoringOnResponse(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!isInitialized) return;

  const responseTime = Date.now() - ((req as FastifyRequest & { securityContext: SecurityContext }).securityContext?.requestStartTime || Date.now());

  try {
    // Create event context for analysis
    const context: EventContext = {
      request: req,
      response: reply,
      body: req.body,
      query: req.query as Record<string, unknown>,
      params: req.params as Record<string, unknown>,
      headers: req.headers as Record<string, string>
    };

    // Run threat detection
    if (threatEngine) {
      const threats = await threatEngine.analyzeRequest(context);
      
      for (const threat of threats) {
        // Send alerts
        if (alerting) {
          await alerting.sendEventAlert(threat);
        }

        // Trigger auto-response
        if (autoResponse) {
          await autoResponse.processSecurityEvent(threat);
        }
      }

      // Update security context
      if (threats.length > 0) {
        const securityContext = (req as FastifyRequest & { securityContext: SecurityContext }).securityContext;
        if (securityContext) {
          securityContext.detectedThreats = threats;
          securityContext.threatScore = Math.max(...threats.map(t => t.confidence));
        }
      }
    }

    // Run anomaly detection
    if (anomalyDetector) {
      const anomalies = await anomalyDetector.analyzeRequest(req, responseTime, reply.statusCode);
      
      for (const anomaly of anomalies) {
        // Send alerts
        if (alerting) {
          await alerting.sendAnomalyAlert(anomaly);
        }

        // Trigger auto-response for high severity anomalies
        if (autoResponse && (anomaly.severity === 'high' || anomaly.severity === 'critical')) {
          await autoResponse.processAnomaly(anomaly);
        }
      }
    }

    // Check for enhanced logging
    if (autoResponse && req.ip) {
      const enhancedLogging = await autoResponse.isEnhancedLoggingEnabled(req.ip, 'ip');
      if (enhancedLogging) {
        // Log detailed request/response info
        console.log('[SecurityMonitoring] Enhanced logging:', {
          requestId: req.id,
          ip: req.ip,
          method: req.method,
          url: req.url,
          statusCode: reply.statusCode,
          responseTime,
          headers: req.headers,
          body: req.body
        });
      }
    }

  } catch (error) {
    console.error('[SecurityMonitoring] Error in onResponse hook:', error);
  }
}

/**
 * Log authentication attempt for threat detection
 */
export async function logAuthAttempt(
  ip: string,
  email: string,
  success: boolean,
  userId?: string
): Promise<void> {
  if (!isInitialized || !threatEngine) return;

  // This will be picked up by the brute force and credential stuffing detection rules
  // The rules check for /auth/login endpoint and 401 responses
}

/**
 * Log password change for account takeover detection
 */
export async function logPasswordChange(
  userId: string,
  ip: string,
  locationChanged: boolean
): Promise<void> {
  if (!isInitialized || !alerting) return;

  if (locationChanged) {
    await alerting.sendCustomAlert(
      'Account Security Warning',
      `Password changed from new location for user ${userId}`,
      ThreatSeverity.HIGH,
      ip,
      { userId, locationChanged }
    );
  }
}

/**
 * Get security context from request
 */
export function getSecurityContext(req: FastifyRequest): SecurityContext | undefined {
  return (req as FastifyRequest & { securityContext: SecurityContext }).securityContext;
}

/**
 * Get threat detection statistics
 */
export function getThreatStats(): {
  threats: ReturnType<ThreatDetectionEngine['getStats']> | null;
  anomalies: ReturnType<AnomalyDetector['getRecentAnomalies']> | null;
  alerts: ReturnType<SecurityAlerting['getStats']> | null;
} {
  return {
    threats: threatEngine?.getStats() || null,
    anomalies: null, // Requires async call
    alerts: alerting?.getStats() || null
  };
}

/**
 * Manually trigger IP block
 */
export async function blockIP(
  ip: string,
  durationMinutes: number,
  reason: string
): Promise<boolean> {
  if (!autoResponse) return false;
  
  // Create a synthetic event for blocking
  const result = await autoResponse.processSecurityEvent({
    id: 'manual-block',
    timestamp: new Date(),
    type: ThreatType.SUSPICIOUS_TRAFFIC,
    severity: ThreatSeverity.HIGH,
    sourceIp: ip,
    userId: undefined,
    sessionId: undefined,
    path: '/manual',
    method: 'POST',
    userAgent: 'admin',
    details: { reason },
    confidence: 1,
    triggeredRules: ['manual_block']
  });

  return result.some(r => r.success && r.action === ResponseAction.BLOCK_IP);
}

/**
 * Manually unblock IP
 */
export async function unblockIP(ip: string): Promise<boolean> {
  if (!autoResponse) return false;
  return await autoResponse.unblockIP(ip);
}

/**
 * Suppress alerts for IP
 */
export function suppressAlerts(
  ip: string,
  threatType: string,
  durationMinutes: number,
  reason: string
): void {
  if (!alerting) return;
  alerting.suppressAlerts(ip, threatType, durationMinutes, reason);
}

/**
 * Security context interface
 */
interface SecurityContext {
  requestStartTime: number;
  requestId: string;
  threatScore: number;
  detectedThreats: SecurityEvent[];
  requiresCaptcha: boolean;
  enhancedLogging: boolean;
}

/**
 * Get blocked IPs
 */
export async function getBlockedIPs(): Promise<Array<{
  ip: string;
  blockedAt: Date;
  expiresAt?: Date;
  reason: string;
}>> {
  if (!autoResponse) return [];
  return await autoResponse.getBlockedIPs();
}

/**
 * Acknowledge alert
 */
export function acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
  if (!alerting) return false;
  return alerting.acknowledgeAlert(alertId, acknowledgedBy);
}

/**
 * Get alert history
 */
export function getAlertHistory(
  limit?: number,
  options?: Parameters<SecurityAlerting['getAlertHistory']>[1]
): ReturnType<SecurityAlerting['getAlertHistory']> {
  if (!alerting) return [];
  return alerting.getAlertHistory(limit, options);
}
