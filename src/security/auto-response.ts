/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Automated response system for security threats
 * Implements countermeasures like IP blocking, CAPTCHA challenges, and enhanced logging
 */

import type { RedisClientType } from 'redis';
import { SecurityEvent, ThreatType, ThreatSeverity } from './threat-detection.js';
import { Anomaly, AnomalySeverity } from './anomaly-detector.js';

/**
 * Response action types
 */
export enum ResponseAction {
  BLOCK_IP = 'block_ip',
  REQUIRE_CAPTCHA = 'require_captcha',
  FORCE_PASSWORD_RESET = 'force_password_reset',
  ENABLE_ENHANCED_LOGGING = 'enable_enhanced_logging',
  THROTTLE_REQUESTS = 'throttle_requests',
  REQUIRE_MFA = 'require_mfa',
  NOTIFY_ADMIN = 'notify_admin',
  QUARANTINE_SESSION = 'quarantine_session'
}

/**
 * Response configuration
 */
export interface ResponseConfig {
  action: ResponseAction;
  enabled: boolean;
  severityThreshold: ThreatSeverity | AnomalySeverity;
  duration: number; // Duration in milliseconds, 0 = permanent
  cooldown: number; // Cooldown period between repeated actions
}

/**
 * Blocked IP entry
 */
interface BlockedIPEntry {
  ip: string;
  blockedAt: Date;
  expiresAt?: Date;
  reason: string;
  eventId: string;
  blockedBy: 'auto' | 'manual';
}

/**
 * CAPTCHA requirement entry
 */
interface CaptchaRequirement {
  ip: string;
  requiredAt: Date;
  expiresAt: Date;
  reason: string;
}

/**
 * Enhanced logging session
 */
interface EnhancedLoggingSession {
  entityId: string;
  entityType: 'ip' | 'user' | 'session';
  enabledAt: Date;
  expiresAt?: Date;
  reason: string;
  eventId: string;
}

/**
 * Response statistics
 */
interface ResponseStats {
  totalActions: number;
  byAction: Record<ResponseAction, number>;
  blockedIPs: number;
  activeCaptchas: number;
  enhancedLoggingSessions: number;
  failed: number;
}

/**
 * Action result
 */
interface ActionResult {
  success: boolean;
  action: ResponseAction;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Automated response system
 */
export class AutoResponseSystem {
  private redis: RedisClientType;
  private configs: Map<ResponseAction, ResponseConfig> = new Map();
  private stats: ResponseStats = {
    totalActions: 0,
    byAction: {} as Record<ResponseAction, number>,
    blockedIPs: 0,
    activeCaptchas: 0,
    enhancedLoggingSessions: 0,
    failed: 0
  };
  private lastActionTime: Map<string, number> = new Map();

  constructor(redis: RedisClientType) {
    this.redis = redis;
    this.initializeDefaultConfigs();
    this.startMaintenanceTasks();
  }

  /**
   * Configure response action
   */
  public configureAction(config: ResponseConfig): void {
    this.configs.set(config.action, config);
    console.log(`[AutoResponse] Configured ${config.action}`);
  }

  /**
   * Process security event and trigger appropriate responses
   */
  public async processSecurityEvent(event: SecurityEvent): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const [action, config] of this.configs) {
      if (!config.enabled) continue;
      if (!this.shouldTriggerForSeverity(event.severity, config.severityThreshold)) continue;
      if (await this.isInCooldown(event.sourceIp, action, config.cooldown)) continue;

      try {
        const result = await this.executeAction(action, event);
        results.push(result);
        
        if (result.success) {
          this.recordAction(action);
          this.lastActionTime.set(`${event.sourceIp}:${action}`, Date.now());
        }
      } catch (error) {
        console.error(`[AutoResponse] Failed to execute ${action}:`, error);
        results.push({
          success: false,
          action,
          message: `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        this.stats.failed++;
      }
    }

    return results;
  }

  /**
   * Process anomaly and trigger responses
   */
  public async processAnomaly(anomaly: Anomaly): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const [action, config] of this.configs) {
      if (!config.enabled) continue;
      if (!this.shouldTriggerForSeverity(anomaly.severity, config.severityThreshold)) continue;
      if (await this.isInCooldown(anomaly.entityId, action, config.cooldown)) continue;

      try {
        const result = await this.executeAnomalyAction(action, anomaly);
        results.push(result);
        
        if (result.success) {
          this.recordAction(action);
          this.lastActionTime.set(`${anomaly.entityId}:${action}`, Date.now());
        }
      } catch (error) {
        console.error(`[AutoResponse] Failed to execute ${action}:`, error);
        results.push({
          success: false,
          action,
          message: `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        this.stats.failed++;
      }
    }

    return results;
  }

  /**
   * Execute response action for security event
   */
  private async executeAction(action: ResponseAction, event: SecurityEvent): Promise<ActionResult> {
    switch (action) {
      case ResponseAction.BLOCK_IP:
        return this.blockIP(event.sourceIp, event);
      case ResponseAction.REQUIRE_CAPTCHA:
        return this.requireCaptcha(event.sourceIp, event);
      case ResponseAction.ENABLE_ENHANCED_LOGGING:
        return this.enableEnhancedLogging(event.sourceIp, 'ip', event);
      case ResponseAction.NOTIFY_ADMIN:
        return this.notifyAdmin(event);
      case ResponseAction.THROTTLE_REQUESTS:
        return this.throttleRequests(event.sourceIp, event);
      default:
        return {
          success: false,
          action,
          message: 'Action not applicable for security events'
        };
    }
  }

  /**
   * Execute response action for anomaly
   */
  private async executeAnomalyAction(action: ResponseAction, anomaly: Anomaly): Promise<ActionResult> {
    switch (action) {
      case ResponseAction.BLOCK_IP:
        if (anomaly.entityType === 'ip') {
          return this.blockIP(anomaly.entityId, undefined, anomaly);
        }
        break;
      case ResponseAction.REQUIRE_CAPTCHA:
        if (anomaly.entityType === 'ip') {
          return this.requireCaptcha(anomaly.entityId, undefined, anomaly);
        }
        break;
      case ResponseAction.ENABLE_ENHANCED_LOGGING:
        return this.enableEnhancedLogging(anomaly.entityId, anomaly.entityType, undefined, anomaly);
      case ResponseAction.THROTTLE_REQUESTS:
        if (anomaly.entityType === 'ip') {
          return this.throttleRequests(anomaly.entityId, undefined, anomaly);
        }
        break;
    }

    return {
      success: false,
      action,
      message: 'Action not applicable for this anomaly type'
    };
  }

  /**
   * Block IP address
   */
  private async blockIP(
    ip: string,
    event?: SecurityEvent,
    anomaly?: Anomaly
  ): Promise<ActionResult> {
    const config = this.configs.get(ResponseAction.BLOCK_IP);
    const duration = config?.duration || 3600000; // Default 1 hour
    
    const entry: BlockedIPEntry = {
      ip,
      blockedAt: new Date(),
      // exactOptionalPropertyTypes: omit expiresAt when absent rather than
      // assigning undefined.
      ...(duration > 0 ? { expiresAt: new Date(Date.now() + duration) } : {}),
      reason: (event?.details?.ruleName as string | undefined) || anomaly?.type || 'Unknown threat',
      eventId: event?.id || anomaly?.id || 'unknown',
      blockedBy: 'auto'
    };

    const key = `security:blocked_ip:${ip}`;
    const ttl = duration > 0 ? Math.floor(duration / 1000) : 86400;
    
    await this.redis.setEx(key, ttl, JSON.stringify(entry));
    await this.redis.sAdd('security:blocked_ips', ip);

    console.log(`[AutoResponse] Blocked IP ${ip} for ${duration > 0 ? `${duration / 1000}s` : 'permanent'}`);

    return {
      success: true,
      action: ResponseAction.BLOCK_IP,
      message: `IP ${ip} blocked successfully`,
      details: { duration, reason: entry.reason }
    };
  }

  /**
   * Require CAPTCHA for IP
   */
  private async requireCaptcha(
    ip: string,
    event?: SecurityEvent,
    anomaly?: Anomaly
  ): Promise<ActionResult> {
    const config = this.configs.get(ResponseAction.REQUIRE_CAPTCHA);
    const duration = config?.duration || 1800000; // Default 30 minutes
    
    const entry: CaptchaRequirement = {
      ip,
      requiredAt: new Date(),
      expiresAt: new Date(Date.now() + duration),
      reason: (event?.details?.ruleName as string | undefined) || anomaly?.type || 'Suspicious activity'
    };

    const key = `security:captcha_required:${ip}`;
    await this.redis.setEx(key, Math.floor(duration / 1000), JSON.stringify(entry));

    console.log(`[AutoResponse] CAPTCHA required for IP ${ip}`);

    return {
      success: true,
      action: ResponseAction.REQUIRE_CAPTCHA,
      message: `CAPTCHA requirement enabled for ${ip}`,
      details: { duration, reason: entry.reason }
    };
  }

  /**
   * Enable enhanced logging
   */
  private async enableEnhancedLogging(
    entityId: string,
    entityType: 'ip' | 'user' | 'session',
    event?: SecurityEvent,
    anomaly?: Anomaly
  ): Promise<ActionResult> {
    const config = this.configs.get(ResponseAction.ENABLE_ENHANCED_LOGGING);
    const duration = config?.duration || 3600000; // Default 1 hour
    
    const session: EnhancedLoggingSession = {
      entityId,
      entityType,
      enabledAt: new Date(),
      ...(duration > 0 ? { expiresAt: new Date(Date.now() + duration) } : {}),
      reason: (event?.details?.ruleName as string | undefined) || anomaly?.type || 'Security investigation',
      eventId: event?.id || anomaly?.id || 'unknown'
    };

    const key = `security:enhanced_logging:${entityType}:${entityId}`;
    const ttl = duration > 0 ? Math.floor(duration / 1000) : 86400;
    
    await this.redis.setEx(key, ttl, JSON.stringify(session));

    console.log(`[AutoResponse] Enhanced logging enabled for ${entityType} ${entityId}`);

    return {
      success: true,
      action: ResponseAction.ENABLE_ENHANCED_LOGGING,
      message: `Enhanced logging enabled for ${entityType} ${entityId}`,
      details: { duration, reason: session.reason }
    };
  }

  /**
   * Throttle requests from IP
   */
  private async throttleRequests(
    ip: string,
    event?: SecurityEvent,
    anomaly?: Anomaly
  ): Promise<ActionResult> {
    const config = this.configs.get(ResponseAction.THROTTLE_REQUESTS);
    const duration = config?.duration || 1800000; // Default 30 minutes
    
    // Add to throttle list with reduced rate limit
    const key = `security:throttle:${ip}`;
    const throttleConfig = {
      maxRequests: 10, // Significantly reduced
      windowMs: 60000, // Per minute
      reason: event?.details?.ruleName || anomaly?.type || 'Rate limit evasion'
    };

    await this.redis.setEx(key, Math.floor(duration / 1000), JSON.stringify(throttleConfig));

    console.log(`[AutoResponse] Request throttling enabled for IP ${ip}`);

    return {
      success: true,
      action: ResponseAction.THROTTLE_REQUESTS,
      message: `Request throttling enabled for ${ip}`,
      details: { duration, maxRequests: throttleConfig.maxRequests }
    };
  }

  /**
   * Notify administrators
   */
  private async notifyAdmin(event: SecurityEvent): Promise<ActionResult> {
    // This will be handled by the alerting system
    // Just log here for now
    console.log(`[AutoResponse] Admin notification triggered for event ${event.id}`);

    return {
      success: true,
      action: ResponseAction.NOTIFY_ADMIN,
      message: 'Admin notification queued',
      details: { eventId: event.id }
    };
  }

  /**
   * Check if IP is blocked
   */
  public async isIPBlocked(ip: string): Promise<boolean> {
    const key = `security:blocked_ip:${ip}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Check if CAPTCHA is required for IP
   */
  public async isCaptchaRequired(ip: string): Promise<CaptchaRequirement | null> {
    const key = `security:captcha_required:${ip}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) as CaptchaRequirement : null;
  }

  /**
   * Check if enhanced logging is enabled
   */
  public async isEnhancedLoggingEnabled(
    entityId: string,
    entityType: 'ip' | 'user' | 'session'
  ): Promise<EnhancedLoggingSession | null> {
    const key = `security:enhanced_logging:${entityType}:${entityId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) as EnhancedLoggingSession : null;
  }

  /**
   * Get throttling config for IP
   */
  public async getThrottlingConfig(ip: string): Promise<{ maxRequests: number; windowMs: number } | null> {
    const key = `security:throttle:${ip}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    
    const config = JSON.parse(data);
    return {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs
    };
  }

  /**
   * Unblock IP
   */
  public async unblockIP(ip: string): Promise<boolean> {
    const key = `security:blocked_ip:${ip}`;
    await this.redis.del(key);
    await this.redis.sRem('security:blocked_ips', ip);
    console.log(`[AutoResponse] Unblocked IP ${ip}`);
    return true;
  }

  /**
   * Remove CAPTCHA requirement
   */
  public async removeCaptchaRequirement(ip: string): Promise<boolean> {
    const key = `security:captcha_required:${ip}`;
    await this.redis.del(key);
    return true;
  }

  /**
   * Disable enhanced logging
   */
  public async disableEnhancedLogging(
    entityId: string,
    entityType: 'ip' | 'user' | 'session'
  ): Promise<boolean> {
    const key = `security:enhanced_logging:${entityType}:${entityId}`;
    await this.redis.del(key);
    return true;
  }

  /**
   * Get all blocked IPs
   */
  public async getBlockedIPs(): Promise<BlockedIPEntry[]> {
    const ips = await this.redis.sMembers('security:blocked_ips');
    const entries: BlockedIPEntry[] = [];

    for (const ip of ips) {
      const key = `security:blocked_ip:${ip}`;
      const data = await this.redis.get(key);
      if (data) {
        entries.push(JSON.parse(data) as BlockedIPEntry);
      }
    }

    return entries;
  }

  /**
   * Get response statistics
   */
  public getStats(): ResponseStats {
    return { ...this.stats };
  }

  /**
   * Check if should trigger for severity
   */
  private shouldTriggerForSeverity(
    eventSeverity: ThreatSeverity | AnomalySeverity,
    threshold: ThreatSeverity | AnomalySeverity
  ): boolean {
    const severityRank: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4
    };
    return (severityRank[eventSeverity] ?? 0) >= (severityRank[threshold] ?? 0);
  }

  /**
   * Check if action is in cooldown
   */
  private async isInCooldown(entityId: string, action: ResponseAction, cooldownMs: number): Promise<boolean> {
    const key = `${entityId}:${action}`;
    const lastTime = this.lastActionTime.get(key);
    
    if (!lastTime) return false;
    
    return Date.now() - lastTime < cooldownMs;
  }

  /**
   * Record action execution
   */
  private recordAction(action: ResponseAction): void {
    this.stats.totalActions++;
    this.stats.byAction[action] = (this.stats.byAction[action] || 0) + 1;
  }

  /**
   * Initialize default configurations
   */
  private initializeDefaultConfigs(): void {
    // Block IP for critical threats
    this.configs.set(ResponseAction.BLOCK_IP, {
      action: ResponseAction.BLOCK_IP,
      enabled: true,
      severityThreshold: ThreatSeverity.CRITICAL,
      duration: 3600000, // 1 hour
      cooldown: 300000 // 5 minutes
    });

    // Require CAPTCHA for high severity
    this.configs.set(ResponseAction.REQUIRE_CAPTCHA, {
      action: ResponseAction.REQUIRE_CAPTCHA,
      enabled: true,
      severityThreshold: ThreatSeverity.HIGH,
      duration: 1800000, // 30 minutes
      cooldown: 60000 // 1 minute
    });

    // Enable enhanced logging for medium+
    this.configs.set(ResponseAction.ENABLE_ENHANCED_LOGGING, {
      action: ResponseAction.ENABLE_ENHANCED_LOGGING,
      enabled: true,
      severityThreshold: ThreatSeverity.MEDIUM,
      duration: 3600000, // 1 hour
      cooldown: 0
    });

    // Throttle requests for high severity
    this.configs.set(ResponseAction.THROTTLE_REQUESTS, {
      action: ResponseAction.THROTTLE_REQUESTS,
      enabled: true,
      severityThreshold: ThreatSeverity.HIGH,
      duration: 1800000, // 30 minutes
      cooldown: 60000 // 1 minute
    });

    // Notify admin for all high+
    this.configs.set(ResponseAction.NOTIFY_ADMIN, {
      action: ResponseAction.NOTIFY_ADMIN,
      enabled: true,
      severityThreshold: ThreatSeverity.HIGH,
      duration: 0,
      cooldown: 60000 // 1 minute
    });
  }

  /**
   * Start maintenance tasks
   */
  private startMaintenanceTasks(): void {
    // Clean up expired entries periodically
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 300000); // Every 5 minutes
  }

  /**
   * Cleanup expired entries
   */
  private async cleanupExpiredEntries(): Promise<void> {
    const blockedIPs = await this.getBlockedIPs();
    const now = new Date();

    for (const entry of blockedIPs) {
      if (entry.expiresAt && entry.expiresAt < now) {
        await this.unblockIP(entry.ip);
      }
    }
  }
}

// Singleton instance
let autoResponseSystem: AutoResponseSystem | null = null;

export function initializeAutoResponse(redis: RedisClientType): AutoResponseSystem {
  if (!autoResponseSystem) {
    autoResponseSystem = new AutoResponseSystem(redis);
  }
  return autoResponseSystem;
}

export function getAutoResponseSystem(): AutoResponseSystem | null {
  return autoResponseSystem;
}
