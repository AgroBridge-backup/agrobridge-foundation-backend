# Threat Detection and Security Monitoring

> ⚠️ **Historical reference only.** The entire threat-detection / security-monitoring subsystem documented below (`src/security/*` — threat-detection, threat-rules, anomaly-detector, alerting, auto-response — plus `src/middleware/security-monitoring.ts` and `src/incident/severity.ts`) was dead code and was **removed in PR #14**. None of these modules, the `/api/security/*` endpoints, the listed env vars, or the `security_*` Prometheus metrics exist in the current codebase. This document is retained so stale links still explain what happened; do not treat it as current behavior.

## Overview

This document describes the comprehensive threat detection and security monitoring system implemented for the AgroBridge Foundation backend.

## Architecture

The security monitoring system consists of the following components:

1. **Threat Detection Engine** - Rule-based detection of attack patterns
2. **Anomaly Detector** - Statistical analysis for unusual behavior
3. **Alerting System** - Multi-channel notification delivery
4. **Auto-Response System** - Automated countermeasures
5. **Security Middleware** - Integration with Fastify request lifecycle

## Components

### 1. Threat Detection Engine (threat-detection.ts)

The core detection engine that analyzes HTTP requests against detection rules.

**Features:**
- Rule-based detection with configurable thresholds
- Real-time analysis of request patterns
- Confidence scoring for detections
- Threat intelligence integration
- Event storage and retrieval

**Usage:**
```typescript
import { initializeThreatDetection } from './security/threat-detection.js';

const engine = initializeThreatDetection(redis);
const events = await engine.analyzeRequest(context);
```

### 2. Detection Rules (threat-rules.ts)

Pre-configured rules for common attack patterns:

| Rule ID | Name | Type | Severity | Description |
|---------|------|------|----------|-------------|
| threat-001 | Brute Force Detection | brute_force | HIGH | >10 failed logins in 5 minutes |
| threat-002 | XSS Attempt | xss_attempt | HIGH | Script tags in inputs |
| threat-003 | SQL Injection | sql_injection | CRITICAL | SQL keywords in requests |
| threat-004 | Rate Limit Evasion | rate_limit_evasion | MEDIUM | Distributed attacks |
| threat-005 | Data Exfiltration | data_exfiltration | CRITICAL | Unusual data access |
| threat-006 | Account Takeover | account_takeover | CRITICAL | New location + password change |
| threat-007 | Bot Detection | bot_traffic | LOW | Non-human traffic |
| threat-008 | Credential Stuffing | credential_stuffing | HIGH | Multiple failed logins |

### 3. Anomaly Detector (anomaly-detector.ts)

Statistical analysis for detecting unusual patterns:

**Anomaly Types:**
- Traffic Volume - Sudden spikes
- Request Rate - Abnormal frequency
- Payload Size - Unusual sizes
- Error Rate - Unexpected errors
- Geolocation - New locations
- Time Pattern - Off-hours activity
- User Behavior - Deviation from normal
- Endpoint Access - Unusual API usage

### 4. Alerting System (alerting.ts)

Multi-channel alerting:

**Channels:**
- Console - Development/debugging
- Slack - Immediate threats
- Email - Medium severity
- PagerDuty - Critical incidents
- Webhook - SIEM integration

**Environment Variables:**
```
SLACK_WEBHOOK_URL - Slack webhook URL
SLACK_CHANNEL - Channel name (default: #security-alerts)
SMTP_HOST - Email server
SMTP_PORT - Email port
SMTP_USER - SMTP username
SMTP_PASS - SMTP password
ALERT_FROM_EMAIL - From address
ALERT_TO_EMAIL - Comma-separated recipients
PAGERDUTY_INTEGRATION_KEY - PD integration key
SIEM_WEBHOOK_URL - SIEM webhook endpoint
```

### 5. Auto-Response System (auto-response.ts)

Automated countermeasures:

**Actions:**
- Block IP - Block malicious addresses
- Require CAPTCHA - Force verification
- Enhanced Logging - Detailed logging
- Throttle Requests - Reduced rate limits

### 6. Security Middleware (security-monitoring.ts)

Fastify middleware integrating all components:

```typescript
// In app.ts
import { initializeSecurityMonitoring } from './middleware/security-monitoring.js';

await initializeSecurityMonitoring();

app.addHook('onRequest', securityMonitoringOnRequest);
app.addHook('onResponse', securityMonitoringOnResponse);
```

## Configuration

### Environment Variables

Required:
```
REDIS_URL - Redis connection string
```

Optional alerting channels:
```
SLACK_WEBHOOK_URL
SMTP_HOST
PAGERDUTY_INTEGRATION_KEY
SIEM_WEBHOOK_URL
```

### Detection Thresholds

Adjust thresholds in detection rules:
- threshold: Number of matches required
- timeWindow: Time window in milliseconds
- confidence: Minimum confidence score (0-1)

## API Endpoints

### Security Status
```
GET /api/security/status
```
Returns current security statistics.

### Blocked IPs
```
GET /api/security/blocked-ips
POST /api/security/block-ip
DELETE /api/security/unblock-ip/:ip
```

### Alerts
```
GET /api/security/alerts
POST /api/security/alerts/:id/acknowledge
```

## Monitoring

### Prometheus Metrics

- security_threat_detection_total - Threat detection counter
- security_detection_latency_seconds - Detection latency
- security_active_threats - Current active threats
- security_blocked_ips - Number of blocked IPs
- security_response_actions_total - Auto-response actions

### Grafana Dashboard

Import dashboards/security-dashboard.json into Grafana for visualization.

### Alertmanager Rules

Configure alerting/security-alerts.yml in Alertmanager for notifications.

## Best Practices

1. **Regular Review** - Review detected threats daily
2. **Tune Thresholds** - Adjust based on false positive rate
3. **Update Rules** - Keep detection patterns current
4. **Monitor Performance** - Ensure detection latency stays low
5. **Backup Config** - Keep copies of rule configurations
6. **Test Alerts** - Regularly verify alerting channels

## Troubleshooting

### High False Positive Rate
- Increase confidence thresholds
- Add suppression rules for known good IPs
- Review and adjust detection rules

### Alerts Not Received
- Check environment variables
- Verify webhook URLs
- Check rate limiting

### Performance Issues
- Monitor detection latency metrics
- Consider reducing rule complexity
- Scale Redis if needed

## Security Considerations

1. **Access Control** - Restrict access to security endpoints
2. **Log Protection** - Secure security event logs
3. **Alert Security** - Protect webhook URLs and API keys
4. **Data Retention** - Configure appropriate retention periods
5. **Audit Trail** - Log all security configuration changes
