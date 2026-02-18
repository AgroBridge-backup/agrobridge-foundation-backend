/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Threat detection rules for AgroBridge Foundation backend
 * Pre-configured rules for common attack patterns
 */

import { 
  DetectionRule, 
  ThreatType, 
  ThreatSeverity 
} from './threat-detection.js';

/**
 * SQL injection detection patterns
 */
export const SQL_INJECTION_PATTERNS = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
  /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
  /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
  /((\%27)|(\'))union/i,
  /exec(\s|\+)+(s|x)p\w+/i,
  /UNION\s+SELECT/i,
  /INSERT\s+INTO/i,
  /DELETE\s+FROM/i,
  /DROP\s+TABLE/i,
  /ALTER\s+TABLE/i,
  /(;|\s*or\s*|\s*and\s*)[\s\d]*=['"]/i,
  /union.*select.*from/i,
  /load_file\s*\(/i,
  /into\s+outfile/i,
  /benchmark\s*\(/i,
  /sleep\s*\(\s*\d+\s*\)/i
];

/**
 * XSS detection patterns
 */
export const XSS_PATTERNS = [
  /<script[^>]*>[\s\S]*?<\/script>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /eval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]javascript:/i,
  /<[^>]+\s+on\w+\s*=/i,
  /alert\s*\(/i,
  /prompt\s*\(/i,
  /confirm\s*\(/i,
  /<[^>]+\s+style\s*=\s*['"]?[^'"]*expression/i,
  /fromCharCode/i,
  /<svg[^>]*>.*?(?:onload|onerror)/is
];

/**
 * Command injection patterns
 */
export const COMMAND_INJECTION_PATTERNS = [
  /[;&|`]\s*\w+/,
  /\$\(\s*\w+/,
  /`\s*\w+/,
  /\|\s*\w+/,
  /;\s*\w+/,
  /&&\s*\w+/,
  /\|\|\s*\w+/,
  /\$\{[^}]*\}/,
  /\\x[0-9a-f]{2}/i,
  /\\u[0-9a-f]{4}/i,
  /\\d\{[^}]*\}/,
  /nslookup\s+/i,
  /curl\s+/i,
  /wget\s+/i,
  /nc\s+/i,
  /netcat\s+/i,
  /bash\s+/i,
  /sh\s+/i,
  /cmd\s+/i,
  /powershell\s+/i
];

/**
 * Path traversal patterns
 */
export const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%2e%2e\//i,
  /%252e%252e%252f/i,
  /\.\.\/%/,
  /%c0%ae%c0%ae/i,
  /%uff0e%uff0e/i,
  /\.{2,}/,
  /\.{2,}\//,
  /\.{2,}\\/
];

/**
 * Bot detection patterns
 */
export const BOT_USER_AGENTS = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /httpclient/i,
  /java\//i,
  /scrapy/i,
  /selenium/i,
  /phantomjs/i,
  /headless/i,
  /puppeteer/i,
  /playwright/i
];

/**
 * Pre-configured detection rules
 */
export const THREAT_DETECTION_RULES: DetectionRule[] = [
  // Rule 1: Brute Force Detection
  {
    id: 'threat-001',
    name: 'Brute Force Login Detection',
    description: 'Detects repeated failed login attempts from a single IP',
    type: ThreatType.BRUTE_FORCE,
    severity: ThreatSeverity.HIGH,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'contains',
        value: '/auth/login'
      },
      {
        field: 'response.statusCode',
        operator: 'equals',
        value: 401
      },
      {
        field: 'request.method',
        operator: 'equals',
        value: 'POST'
      }
    ],
    threshold: 10,
    timeWindow: 300000, // 5 minutes
    confidence: 0.9
  },

  // Rule 2: XSS Attempt Detection
  {
    id: 'threat-002',
    name: 'Cross-Site Scripting (XSS) Attempt',
    description: 'Detects potential XSS attacks in form inputs',
    type: ThreatType.XSS_ATTEMPT,
    severity: ThreatSeverity.HIGH,
    enabled: true,
    conditions: [
      {
        field: 'body',
        operator: 'regex',
        value: XSS_PATTERNS.map(p => p.source).join('|')
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.85
  },

  // Rule 3: SQL Injection Detection
  {
    id: 'threat-003',
    name: 'SQL Injection Attempt',
    description: 'Detects SQL injection patterns in request data',
    type: ThreatType.SQL_INJECTION,
    severity: ThreatSeverity.CRITICAL,
    enabled: true,
    conditions: [
      {
        field: 'body',
        operator: 'regex',
        value: SQL_INJECTION_PATTERNS.map(p => p.source).join('|')
      },
      {
        field: 'query',
        operator: 'regex',
        value: SQL_INJECTION_PATTERNS.map(p => p.source).join('|')
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.95
  },

  // Rule 4: Rate Limit Evasion Detection
  {
    id: 'threat-004',
    name: 'Rate Limit Evasion',
    description: 'Detects distributed attacks attempting to evade rate limits',
    type: ThreatType.RATE_LIMIT_EVASION,
    severity: ThreatSeverity.MEDIUM,
    enabled: true,
    conditions: [
      {
        field: 'request.headers.x-forwarded-for',
        operator: 'exists'
      },
      {
        field: 'request.headers.user-agent',
        operator: 'regex',
        value: 'same-pattern-multiple-ips'
      }
    ],
    threshold: 5,
    timeWindow: 60000, // 1 minute
    confidence: 0.7
  },

  // Rule 5: Data Exfiltration Detection
  {
    id: 'threat-005',
    name: 'Potential Data Exfiltration',
    description: 'Detects unusual data access patterns that may indicate exfiltration',
    type: ThreatType.DATA_EXFILTRATION,
    severity: ThreatSeverity.CRITICAL,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'regex',
        value: '/api/(users|donations|contacts|admin)'
      },
      {
        field: 'response.headers.content-length',
        operator: 'gt',
        value: 1000000 // 1MB
      }
    ],
    threshold: 3,
    timeWindow: 300000, // 5 minutes
    confidence: 0.75
  },

  // Rule 6: Account Takeover Detection
  {
    id: 'threat-006',
    name: 'Account Takeover Attempt',
    description: 'Detects login from new location followed by password change',
    type: ThreatType.ACCOUNT_TAKEOVER,
    severity: ThreatSeverity.CRITICAL,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'contains',
        value: '/auth/change-password'
      },
      {
        field: 'request.headers.referer',
        operator: 'contains',
        value: '/login'
      }
    ],
    threshold: 1,
    timeWindow: 60000, // 1 minute
    confidence: 0.8
  },

  // Rule 7: Bot Traffic Detection
  {
    id: 'threat-007',
    name: 'Bot Traffic Detection',
    description: 'Identifies non-human traffic patterns',
    type: ThreatType.BOT_TRAFFIC,
    severity: ThreatSeverity.LOW,
    enabled: true,
    conditions: [
      {
        field: 'request.headers.user-agent',
        operator: 'regex',
        value: BOT_USER_AGENTS.map(p => p.source).join('|')
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.8
  },

  // Rule 8: Credential Stuffing Detection
  {
    id: 'threat-008',
    name: 'Credential Stuffing Attack',
    description: 'Detects multiple failed logins with different usernames from single IP',
    type: ThreatType.CREDENTIAL_STUFFING,
    severity: ThreatSeverity.HIGH,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'contains',
        value: '/auth/login'
      },
      {
        field: 'response.statusCode',
        operator: 'equals',
        value: 401
      },
      {
        field: 'body.email',
        operator: 'exists'
      }
    ],
    threshold: 5,
    timeWindow: 300000, // 5 minutes
    confidence: 0.85
  },

  // Rule 9: Command Injection Detection
  {
    id: 'threat-009',
    name: 'Command Injection Attempt',
    description: 'Detects OS command injection attempts',
    type: ThreatType.SUSPICIOUS_TRAFFIC,
    severity: ThreatSeverity.CRITICAL,
    enabled: true,
    conditions: [
      {
        field: 'body',
        operator: 'regex',
        value: COMMAND_INJECTION_PATTERNS.map(p => p.source).join('|')
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.9
  },

  // Rule 10: Path Traversal Detection
  {
    id: 'threat-010',
    name: 'Path Traversal Attempt',
    description: 'Detects directory traversal attacks',
    type: ThreatType.SUSPICIOUS_TRAFFIC,
    severity: ThreatSeverity.HIGH,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'regex',
        value: PATH_TRAVERSAL_PATTERNS.map(p => p.source).join('|')
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.9
  },

  // Rule 11: Sensitive Data Access
  {
    id: 'threat-011',
    name: 'Sensitive Data Access Pattern',
    description: 'Detects access to sensitive endpoints without proper authorization',
    type: ThreatType.DATA_EXFILTRATION,
    severity: ThreatSeverity.MEDIUM,
    enabled: true,
    conditions: [
      {
        field: 'request.url',
        operator: 'regex',
        value: '/api/admin/(users|donations|contacts)'
      },
      {
        field: 'response.statusCode',
        operator: 'equals',
        value: 403
      }
    ],
    threshold: 3,
    timeWindow: 300000, // 5 minutes
    confidence: 0.7
  },

  // Rule 12: API Key Exposure Detection
  {
    id: 'threat-012',
    name: 'Potential API Key Exposure',
    description: 'Detects API keys in error responses or logs',
    type: ThreatType.DATA_EXFILTRATION,
    severity: ThreatSeverity.HIGH,
    enabled: true,
    conditions: [
      {
        field: 'response.body',
        operator: 'regex',
        value: '(api[_-]?key|apikey|secret[_-]?key|token)\s*[:=]\s*["\'][a-zA-Z0-9]{20,}["\']'
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.85
  },

  // Rule 13: Mass Assignment Attempt
  {
    id: 'threat-013',
    name: 'Mass Assignment Attempt',
    description: 'Detects attempts to modify restricted fields',
    type: ThreatType.SUSPICIOUS_TRAFFIC,
    severity: ThreatSeverity.MEDIUM,
    enabled: true,
    conditions: [
      {
        field: 'body',
        operator: 'regex',
        value: '(isAdmin|role|permissions|id|createdAt|updatedAt)'
      }
    ],
    threshold: 1,
    timeWindow: 0,
    confidence: 0.6
  },

  // Rule 14: Slowloris-style Attack
  {
    id: 'threat-014',
    name: 'Slow HTTP Attack',
    description: 'Detects slow HTTP attacks (Slowloris, R-U-Dead-Yet)',
    type: ThreatType.SUSPICIOUS_TRAFFIC,
    severity: ThreatSeverity.MEDIUM,
    enabled: true,
    conditions: [
      {
        field: 'request.headers.connection',
        operator: 'regex',
        value: 'keep-alive'
      },
      {
        field: 'request.headers.content-length',
        operator: 'gt',
        value: 0
      }
    ],
    threshold: 10,
    timeWindow: 60000, // 1 minute
    confidence: 0.65
  }
];

/**
 * Get all enabled rules
 */
export function getEnabledRules(): DetectionRule[] {
  return THREAT_DETECTION_RULES.filter(rule => rule.enabled);
}

/**
 * Get rule by ID
 */
export function getRuleById(id: string): DetectionRule | undefined {
  return THREAT_DETECTION_RULES.find(rule => rule.id === id);
}

/**
 * Get rules by type
 */
export function getRulesByType(type: ThreatType): DetectionRule[] {
  return THREAT_DETECTION_RULES.filter(rule => rule.type === type);
}

/**
 * Validate rule configuration
 */
export function validateRule(rule: DetectionRule): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rule.id || rule.id.length < 3) {
    errors.push('Rule ID must be at least 3 characters');
  }

  if (!rule.name || rule.name.length < 5) {
    errors.push('Rule name must be at least 5 characters');
  }

  if (!rule.description || rule.description.length < 10) {
    errors.push('Rule description must be at least 10 characters');
  }

  if (!Object.values(ThreatType).includes(rule.type)) {
    errors.push('Invalid threat type');
  }

  if (!Object.values(ThreatSeverity).includes(rule.severity)) {
    errors.push('Invalid severity level');
  }

  if (rule.threshold < 1) {
    errors.push('Threshold must be at least 1');
  }

  if (rule.timeWindow < 0) {
    errors.push('Time window must be non-negative');
  }

  if (rule.confidence < 0 || rule.confidence > 1) {
    errors.push('Confidence must be between 0 and 1');
  }

  if (!rule.conditions || rule.conditions.length === 0) {
    errors.push('At least one condition is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if string contains SQL injection patterns
 */
export function containsSQLInjection(value: string): boolean {
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if string contains XSS patterns
 */
export function containsXSS(value: string): boolean {
  return XSS_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if user agent is a bot
 */
export function isBot(userAgent: string): boolean {
  return BOT_USER_AGENTS.some(pattern => pattern.test(userAgent));
}

/**
 * Sanitize input for safe logging
 */
export function sanitizeForLog(value: string): string {
  return value
    .replace(/[\n\r]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 1000);
}
