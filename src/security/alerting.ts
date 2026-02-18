/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Security alerting system with multi-channel dispatch
 * Supports Slack, Email, PagerDuty, and webhook integrations
 */

import { SecurityEvent, ThreatType, ThreatSeverity } from './threat-detection.js';
import { Anomaly, AnomalySeverity, AnomalyType } from './anomaly-detector.js';

/**
 * Alert channel types
 */
export enum AlertChannel {
  SLACK = 'slack',
  EMAIL = 'email',
  PAGERDUTY = 'pagerduty',
  WEBHOOK = 'webhook',
  CONSOLE = 'console'
}

/**
 * Alert configuration
 */
export interface AlertConfiguration {
  channel: AlertChannel;
  enabled: boolean;
  severityThreshold: ThreatSeverity | AnomalySeverity;
  rateLimitWindowMs: number;
  maxAlertsPerWindow: number;
  config: SlackConfig | EmailConfig | PagerDutyConfig | WebhookConfig;
}

/**
 * Slack configuration
 */
interface SlackConfig {
  webhookUrl: string;
  channel: string;
  username: string;
  iconEmoji?: string;
}

/**
 * Email configuration
 */
interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  from: string;
  to: string[];
  secure: boolean;
}

/**
 * PagerDuty configuration
 */
interface PagerDutyConfig {
  integrationKey: string;
  serviceId: string;
  urgency: 'high' | 'low';
}

/**
 * Webhook configuration
 */
interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers: Record<string, string>;
  timeout: number;
}

/**
 * Alert structure
 */
export interface SecurityAlert {
  id: string;
  timestamp: Date;
  channel: AlertChannel;
  severity: ThreatSeverity | AnomalySeverity;
  title: string;
  message: string;
  eventId?: string;
  anomalyId?: string;
  sourceIp: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
}

/**
 * Alert suppression entry
 */
interface SuppressionEntry {
  sourceIp: string;
  type: string;
  suppressedUntil: Date;
  reason: string;
}

/**
 * Alerting statistics
 */
interface AlertStats {
  totalSent: number;
  byChannel: Record<AlertChannel, number>;
  bySeverity: Record<string, number>;
  suppressed: number;
  failed: number;
}

/**
 * Severity ranking for comparison
 */
const SEVERITY_RANK: Record<string, number> = {
  [ThreatSeverity.LOW]: 1,
  [ThreatSeverity.MEDIUM]: 2,
  [ThreatSeverity.HIGH]: 3,
  [ThreatSeverity.CRITICAL]: 4,
  [AnomalySeverity.LOW]: 1,
  [AnomalySeverity.MEDIUM]: 2,
  [AnomalySeverity.HIGH]: 3,
  [AnomalySeverity.CRITICAL]: 4
};

/**
 * Security alerting system
 */
export class SecurityAlerting {
  private configurations: Map<AlertChannel, AlertConfiguration> = new Map();
  private alertHistory: SecurityAlert[] = [];
  private suppressionList: Map<string, SuppressionEntry> = new Map();
  private rateLimitCounters: Map<string, { count: number; resetTime: number }> = new Map();
  private stats: AlertStats = {
    totalSent: 0,
    byChannel: {} as Record<AlertChannel, number>,
    bySeverity: {},
    suppressed: 0,
    failed: 0
  };
  private readonly maxHistorySize = 10000;

  constructor() {
    this.startRateLimitReset();
  }

  /**
   * Configure an alert channel
   */
  public configureChannel(config: AlertConfiguration): void {
    this.configurations.set(config.channel, config);
    console.log(`[Alerting] Configured ${config.channel} channel`);
  }

  /**
   * Send alert for security event
   */
  public async sendEventAlert(event: SecurityEvent): Promise<void> {
    for (const [channel, config] of this.configurations) {
      if (!config.enabled) continue;
      if (!this.shouldSendForSeverity(event.severity, config.severityThreshold)) continue;
      if (await this.isSuppressed(event)) continue;
      if (!this.checkRateLimit(channel, config)) continue;

      try {
        const alert = this.createAlertFromEvent(event, channel);
        await this.dispatchAlert(alert, config);
        this.recordAlert(alert);
      } catch (error) {
        console.error(`[Alerting] Failed to send ${channel} alert:`, error);
        this.stats.failed++;
      }
    }
  }

  /**
   * Send alert for anomaly
   */
  public async sendAnomalyAlert(anomaly: Anomaly): Promise<void> {
    for (const [channel, config] of this.configurations) {
      if (!config.enabled) continue;
      if (!this.shouldSendForSeverity(anomaly.severity, config.severityThreshold)) continue;
      if (!this.checkRateLimit(channel, config)) continue;

      try {
        const alert = this.createAlertFromAnomaly(anomaly, channel);
        await this.dispatchAlert(alert, config);
        this.recordAlert(alert);
      } catch (error) {
        console.error(`[Alerting] Failed to send ${channel} alert:`, error);
        this.stats.failed++;
      }
    }
  }

  /**
   * Send custom alert
   */
  public async sendCustomAlert(
    title: string,
    message: string,
    severity: ThreatSeverity | AnomalySeverity,
    sourceIp: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    for (const [channel, config] of this.configurations) {
      if (!config.enabled) continue;
      if (!this.shouldSendForSeverity(severity, config.severityThreshold)) continue;
      if (!this.checkRateLimit(channel, config)) continue;

      try {
        const alert: SecurityAlert = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          channel,
          severity,
          title,
          message,
          sourceIp,
          metadata,
          acknowledged: false
        };
        await this.dispatchAlert(alert, config);
        this.recordAlert(alert);
      } catch (error) {
        console.error(`[Alerting] Failed to send ${channel} alert:`, error);
        this.stats.failed++;
      }
    }
  }

  /**
   * Dispatch alert to appropriate channel
   */
  private async dispatchAlert(alert: SecurityAlert, config: AlertConfiguration): Promise<void> {
    switch (config.channel) {
      case AlertChannel.SLACK:
        await this.sendSlackAlert(alert, config.config as SlackConfig);
        break;
      case AlertChannel.EMAIL:
        await this.sendEmailAlert(alert, config.config as EmailConfig);
        break;
      case AlertChannel.PAGERDUTY:
        await this.sendPagerDutyAlert(alert, config.config as PagerDutyConfig);
        break;
      case AlertChannel.WEBHOOK:
        await this.sendWebhookAlert(alert, config.config as WebhookConfig);
        break;
      case AlertChannel.CONSOLE:
        this.sendConsoleAlert(alert);
        break;
    }
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: SecurityAlert, config: SlackConfig): Promise<void> {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    const payload = {
      channel: config.channel,
      username: config.username,
      icon_emoji: config.iconEmoji || ':warning:',
      attachments: [
        {
          color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true
            },
            {
              title: 'Source IP',
              value: alert.sourceIp,
              short: true
            },
            {
              title: 'Timestamp',
              value: alert.timestamp.toISOString(),
              short: true
            },
            {
              title: 'Alert ID',
              value: alert.id,
              short: true
            }
          ],
          footer: 'AgroBridge Foundation Security',
          ts: Math.floor(alert.timestamp.getTime() / 1000)
        }
      ]
    };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }
  }

  /**
   * Send Email alert
   */
  private async sendEmailAlert(alert: SecurityAlert, config: EmailConfig): Promise<void> {
    // Note: In production, use a proper email library like nodemailer
    // This is a simplified implementation
    console.log(`[Email Alert] ${alert.title}`);
    console.log(`To: ${config.to.join(', ')}`);
    console.log(`Subject: [SECURITY] ${alert.severity.toUpperCase()}: ${alert.title}`);
    console.log(`Body: ${alert.message}`);
  }

  /**
   * Send PagerDuty alert
   */
  private async sendPagerDutyAlert(alert: SecurityAlert, config: PagerDutyConfig): Promise<void> {
    const payload = {
      routing_key: config.integrationKey,
      event_action: 'trigger',
      dedup_key: alert.id,
      payload: {
        summary: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        source: alert.sourceIp,
        severity: this.mapToPagerDutySeverity(alert.severity),
        custom_details: alert.metadata
      }
    };

    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`PagerDuty API error: ${response.status}`);
    }
  }

  /**
   * Send Webhook alert
   */
  private async sendWebhookAlert(alert: SecurityAlert, config: WebhookConfig): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers
        },
        body: JSON.stringify(alert),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send console alert
   */
  private sendConsoleAlert(alert: SecurityAlert): void {
    const prefix = `[SECURITY ALERT - ${alert.severity.toUpperCase()}]`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${prefix} ${alert.title}`);
    console.log(`${'-'.repeat(60)}`);
    console.log(`Time: ${alert.timestamp.toISOString()}`);
    console.log(`Source IP: ${alert.sourceIp}`);
    console.log(`Message: ${alert.message}`);
    if (Object.keys(alert.metadata).length > 0) {
      console.log(`Metadata:`, JSON.stringify(alert.metadata, null, 2));
    }
    console.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Create alert from security event
   */
  private createAlertFromEvent(event: SecurityEvent, channel: AlertChannel): SecurityAlert {
    const title = `Security Event: ${this.formatThreatType(event.type)}`;
    const message = this.formatEventMessage(event);

    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      channel,
      severity: event.severity,
      title,
      message,
      eventId: event.id,
      sourceIp: event.sourceIp,
      metadata: {
        eventType: event.type,
        confidence: event.confidence,
        path: event.path,
        method: event.method,
        triggeredRules: event.triggeredRules,
        details: event.details
      },
      acknowledged: false
    };
  }

  /**
   * Create alert from anomaly
   */
  private createAlertFromAnomaly(anomaly: Anomaly, channel: AlertChannel): SecurityAlert {
    const title = `Anomaly Detected: ${this.formatAnomalyType(anomaly.type)}`;
    const message = this.formatAnomalyMessage(anomaly);

    return {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      channel,
      severity: anomaly.severity,
      title,
      message,
      anomalyId: anomaly.id,
      sourceIp: anomaly.entityId,
      metadata: {
        anomalyType: anomaly.type,
        deviation: anomaly.deviation,
        currentValue: anomaly.currentValue,
        expectedValue: anomaly.expectedValue,
        entityType: anomaly.entityType,
        details: anomaly.details
      },
      acknowledged: false
    };
  }

  /**
   * Format threat type for display
   */
  private formatThreatType(type: ThreatType): string {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Format anomaly type for display
   */
  private formatAnomalyType(type: AnomalyType): string {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Format event message
   */
  private formatEventMessage(event: SecurityEvent): string {
    let message = `Detected ${event.type} from IP ${event.sourceIp}`;
    message += `\nPath: ${event.method} ${event.path}`;
    message += `\nConfidence: ${(event.confidence * 100).toFixed(1)}%`;
    
    if (event.userId) {
      message += `\nUser ID: ${event.userId}`;
    }
    
    if (event.triggeredRules.length > 0) {
      message += `\nTriggered Rules: ${event.triggeredRules.join(', ')}`;
    }

    return message;
  }

  /**
   * Format anomaly message
   */
  private formatAnomalyMessage(anomaly: Anomaly): string {
    let message = `Detected ${anomaly.type} anomaly for ${anomaly.entityType} ${anomaly.entityId}`;
    message += `\nDeviation: ${anomaly.deviation.toFixed(2)} standard deviations`;
    message += `\nCurrent: ${anomaly.currentValue.toFixed(2)}, Expected: ${anomaly.expectedValue.toFixed(2)}`;
    message += `\nConfidence: ${(anomaly.confidence * 100).toFixed(1)}%`;

    return message;
  }

  /**
   * Check if alert should be sent for severity
   */
  private shouldSendForSeverity(
    alertSeverity: ThreatSeverity | AnomalySeverity,
    threshold: ThreatSeverity | AnomalySeverity
  ): boolean {
    return SEVERITY_RANK[alertSeverity] >= SEVERITY_RANK[threshold];
  }

  /**
   * Check rate limit for channel
   */
  private checkRateLimit(channel: AlertChannel, config: AlertConfiguration): boolean {
    const key = `${channel}:${new Date().toISOString().split(':')[0]}`; // Hourly buckets
    const now = Date.now();
    
    const counter = this.rateLimitCounters.get(key);
    if (!counter || now > counter.resetTime) {
      this.rateLimitCounters.set(key, {
        count: 1,
        resetTime: now + config.rateLimitWindowMs
      });
      return true;
    }

    if (counter.count >= config.maxAlertsPerWindow) {
      return false;
    }

    counter.count++;
    return true;
  }

  /**
   * Check if event is suppressed
   */
  private async isSuppressed(event: SecurityEvent): Promise<boolean> {
    const key = `${event.sourceIp}:${event.type}`;
    const entry = this.suppressionList.get(key);
    
    if (entry && entry.suppressedUntil > new Date()) {
      this.stats.suppressed++;
      return true;
    }

    return false;
  }

  /**
   * Suppress alerts for IP and type
   */
  public suppressAlerts(
    sourceIp: string,
    type: string,
    durationMinutes: number,
    reason: string
  ): void {
    const key = `${sourceIp}:${type}`;
    const suppressedUntil = new Date(Date.now() + durationMinutes * 60000);
    
    this.suppressionList.set(key, {
      sourceIp,
      type,
      suppressedUntil,
      reason
    });

    console.log(`[Alerting] Suppressed ${type} alerts for ${sourceIp} for ${durationMinutes} minutes`);
  }

  /**
   * Remove suppression
   */
  public removeSuppression(sourceIp: string, type: string): void {
    const key = `${sourceIp}:${type}`;
    this.suppressionList.delete(key);
  }

  /**
   * Acknowledge alert
   */
  public acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert || alert.acknowledged) return false;

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;
    return true;
  }

  /**
   * Record alert in history
   */
  private recordAlert(alert: SecurityAlert): void {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }

    this.stats.totalSent++;
    this.stats.byChannel[alert.channel] = (this.stats.byChannel[alert.channel] || 0) + 1;
    this.stats.bySeverity[alert.severity] = (this.stats.bySeverity[alert.severity] || 0) + 1;
  }

  /**
   * Get alert history
   */
  public getAlertHistory(
    limit: number = 100,
    options?: {
      channel?: AlertChannel;
      severity?: ThreatSeverity | AnomalySeverity;
      acknowledged?: boolean;
    }
  ): SecurityAlert[] {
    let alerts = [...this.alertHistory];

    if (options?.channel) {
      alerts = alerts.filter(a => a.channel === options.channel);
    }
    if (options?.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }
    if (options?.acknowledged !== undefined) {
      alerts = alerts.filter(a => a.acknowledged === options.acknowledged);
    }

    return alerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get alerting statistics
   */
  public getStats(): AlertStats {
    return { ...this.stats };
  }

  /**
   * Get severity color for Slack
   */
  private getSeverityColor(severity: string): string {
    const colors: Record<string, string> = {
      [ThreatSeverity.LOW]: '#36a64f',
      [ThreatSeverity.MEDIUM]: '#ff9900',
      [ThreatSeverity.HIGH]: '#ff0000',
      [ThreatSeverity.CRITICAL]: '#990000',
      [AnomalySeverity.LOW]: '#36a64f',
      [AnomalySeverity.MEDIUM]: '#ff9900',
      [AnomalySeverity.HIGH]: '#ff0000',
      [AnomalySeverity.CRITICAL]: '#990000'
    };
    return colors[severity] || '#808080';
  }

  /**
   * Get severity emoji
   */
  private getSeverityEmoji(severity: string): string {
    const emojis: Record<string, string> = {
      [ThreatSeverity.LOW]: ':information_source:',
      [ThreatSeverity.MEDIUM]: ':warning:',
      [ThreatSeverity.HIGH]: ':exclamation:',
      [ThreatSeverity.CRITICAL]: ':rotating_light:',
      [AnomalySeverity.LOW]: ':information_source:',
      [AnomalySeverity.MEDIUM]: ':warning:',
      [AnomalySeverity.HIGH]: ':exclamation:',
      [AnomalySeverity.CRITICAL]: ':rotating_light:'
    };
    return emojis[severity] || ':grey_question:';
  }

  /**
   * Map severity to PagerDuty severity
   */
  private mapToPagerDutySeverity(severity: string): string {
    const mapping: Record<string, string> = {
      [ThreatSeverity.LOW]: 'warning',
      [ThreatSeverity.MEDIUM]: 'warning',
      [ThreatSeverity.HIGH]: 'error',
      [ThreatSeverity.CRITICAL]: 'critical',
      [AnomalySeverity.LOW]: 'warning',
      [AnomalySeverity.MEDIUM]: 'warning',
      [AnomalySeverity.HIGH]: 'error',
      [AnomalySeverity.CRITICAL]: 'critical'
    };
    return mapping[severity] || 'warning';
  }

  /**
   * Start rate limit reset job
   */
  private startRateLimitReset(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, counter] of this.rateLimitCounters) {
        if (now > counter.resetTime) {
          this.rateLimitCounters.delete(key);
        }
      }
    }, 60000); // Every minute
  }
}

// Singleton instance
let alerting: SecurityAlerting | null = null;

export function initializeAlerting(): SecurityAlerting {
  if (!alerting) {
    alerting = new SecurityAlerting();
  }
  return alerting;
}

export function getAlerting(): SecurityAlerting | null {
  return alerting;
}
