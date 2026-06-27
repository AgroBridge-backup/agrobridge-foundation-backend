/**
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 * @description Incident Severity Classification System (SEV1-SEV5)
 * @module incident/severity
 */

export enum SeverityLevel {
  SEV1 = 1,
  SEV2 = 2,
  SEV3 = 3,
  SEV4 = 4,
  SEV5 = 5,
}

export interface SeverityDefinition {
  level: SeverityLevel;
  name: string;
  description: string;
  revenueImpact: string;
  userImpact: string;
  responseTimeSLO: number; // minutes
  resolutionTimeSLO: number; // minutes
  escalationTime: number; // minutes
  pageOnCall: boolean;
  executiveNotify: boolean;
  statusPage: boolean;
  postMortemRequired: boolean;
}

export const SEVERITY_DEFINITIONS: Record<SeverityLevel, SeverityDefinition> = {
  [SeverityLevel.SEV1]: {
    level: SeverityLevel.SEV1,
    name: 'SEV1 - Critical',
    description: 'Complete system outage or major functionality failure affecting all users',
    revenueImpact: '>$10,000/hour revenue loss',
    userImpact: 'All users unable to access core functionality',
    responseTimeSLO: 5,
    resolutionTimeSLO: 60,
    escalationTime: 15,
    pageOnCall: true,
    executiveNotify: true,
    statusPage: true,
    postMortemRequired: true,
  },
  [SeverityLevel.SEV2]: {
    level: SeverityLevel.SEV2,
    name: 'SEV2 - Major',
    description: 'Major functionality degraded with workaround available',
    revenueImpact: '$1,000-$10,000/hour revenue impact',
    userImpact: 'Significant functionality impaired, workaround exists',
    responseTimeSLO: 15,
    resolutionTimeSLO: 240,
    escalationTime: 60,
    pageOnCall: true,
    executiveNotify: false,
    statusPage: true,
    postMortemRequired: true,
  },
  [SeverityLevel.SEV3]: {
    level: SeverityLevel.SEV3,
    name: 'SEV3 - Minor',
    description: 'Minor impact on functionality, no workaround needed',
    revenueImpact: '<$1,000/hour revenue impact',
    userImpact: 'Some users affected, core functionality works',
    responseTimeSLO: 60,
    resolutionTimeSLO: 480,
    escalationTime: 240,
    pageOnCall: false,
    executiveNotify: false,
    statusPage: false,
    postMortemRequired: false,
  },
  [SeverityLevel.SEV4]: {
    level: SeverityLevel.SEV4,
    name: 'SEV4 - Low',
    description: 'Low priority issue with minimal user impact',
    revenueImpact: 'No direct revenue impact',
    userImpact: 'Minimal impact on user experience',
    responseTimeSLO: 240,
    resolutionTimeSLO: 1440,
    escalationTime: 480,
    pageOnCall: false,
    executiveNotify: false,
    statusPage: false,
    postMortemRequired: false,
  },
  [SeverityLevel.SEV5]: {
    level: SeverityLevel.SEV5,
    name: 'SEV5 - Preventive',
    description: 'No user impact, preventive action required',
    revenueImpact: 'Potential future impact',
    userImpact: 'No current user impact',
    responseTimeSLO: 480,
    resolutionTimeSLO: 10080,
    escalationTime: 1440,
    pageOnCall: false,
    executiveNotify: false,
    statusPage: false,
    postMortemRequired: false,
  },
};

export interface SeverityCriteria {
  metric: string;
  thresholds: {
    sev1: number;
    sev2: number;
    sev3: number;
    sev4: number;
  };
}

export const AUTOMATIC_SEVERITY_CRITERIA: SeverityCriteria[] = [
  {
    metric: 'error_rate',
    thresholds: {
      sev1: 50, // >50% error rate
      sev2: 25,
      sev3: 10,
      sev4: 5,
    },
  },
  {
    metric: 'latency_p99',
    thresholds: {
      sev1: 10000, // >10s
      sev2: 5000,
      sev3: 2000,
      sev4: 1000,
    },
  },
  {
    metric: 'availability',
    thresholds: {
      sev1: 95, // <95% availability
      sev2: 97,
      sev3: 99,
      sev4: 99.5,
    },
  },
  {
    metric: 'failed_payment_rate',
    thresholds: {
      sev1: 30, // >30% payment failures
      sev2: 15,
      sev3: 5,
      sev4: 2,
    },
  },
];

export function determineSeverityFromMetrics(metrics: {
  errorRate?: number;
  latencyP99?: number;
  availability?: number;
  failedPaymentRate?: number;
}): SeverityLevel {
  const checks = [
    { metric: 'error_rate', value: metrics.errorRate, thresholds: AUTOMATIC_SEVERITY_CRITERIA[0]!.thresholds },
    { metric: 'latency_p99', value: metrics.latencyP99, thresholds: AUTOMATIC_SEVERITY_CRITERIA[1]!.thresholds },
    { metric: 'availability', value: metrics.availability ? 100 - metrics.availability : undefined, thresholds: { sev1: 5, sev2: 3, sev3: 1, sev4: 0.5 } },
    { metric: 'failed_payment_rate', value: metrics.failedPaymentRate, thresholds: AUTOMATIC_SEVERITY_CRITERIA[3]!.thresholds },
  ];

  let highestSeverity = SeverityLevel.SEV5;

  for (const check of checks) {
    if (check.value === undefined) continue;

    if (check.value >= check.thresholds.sev1) {
      return SeverityLevel.SEV1;
    } else if (check.value >= check.thresholds.sev2 && highestSeverity > SeverityLevel.SEV2) {
      highestSeverity = SeverityLevel.SEV2;
    } else if (check.value >= check.thresholds.sev3 && highestSeverity > SeverityLevel.SEV3) {
      highestSeverity = SeverityLevel.SEV3;
    } else if (check.value >= check.thresholds.sev4 && highestSeverity > SeverityLevel.SEV4) {
      highestSeverity = SeverityLevel.SEV4;
    }
  }

  return highestSeverity;
}

export function getSeverityDefinition(level: SeverityLevel): SeverityDefinition {
  return SEVERITY_DEFINITIONS[level];
}

export function shouldPageOnCall(severity: SeverityLevel): boolean {
  return SEVERITY_DEFINITIONS[severity].pageOnCall;
}

export function shouldNotifyExecutive(severity: SeverityLevel): boolean {
  return SEVERITY_DEFINITIONS[severity].executiveNotify;
}

export function shouldUpdateStatusPage(severity: SeverityLevel): boolean {
  return SEVERITY_DEFINITIONS[severity].statusPage;
}

export function requiresPostMortem(severity: SeverityLevel): boolean {
  return SEVERITY_DEFINITIONS[severity].postMortemRequired;
}

export function isWithinResponseSLO(severity: SeverityLevel, minutesSinceStart: number): boolean {
  return minutesSinceStart <= SEVERITY_DEFINITIONS[severity].responseTimeSLO;
}

export function isWithinResolutionSLO(severity: SeverityLevel, minutesSinceStart: number): boolean {
  return minutesSinceStart <= SEVERITY_DEFINITIONS[severity].resolutionTimeSLO;
}

export function shouldEscalate(severity: SeverityLevel, minutesSinceStart: number): boolean {
  return minutesSinceStart >= SEVERITY_DEFINITIONS[severity].escalationTime;
}
