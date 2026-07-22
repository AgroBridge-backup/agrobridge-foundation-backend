/**
 * Error Taxonomy for AgroBridge Foundation
 * 
 * Provides structured error classification with codes, categories, and severity levels
 * for comprehensive observability and alerting.
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

/**
 * Error severity levels for alerting and prioritization
 */
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Error categories for classification and routing
 */
export type ErrorCategory = 
  | 'INFRASTRUCTURE' 
  | 'VENDOR' 
  | 'APPLICATION' 
  | 'SECURITY' 
  | 'CLIENT';

/**
 * Infrastructure error subtypes
 */
export type InfrastructureErrorType =
  | 'DB_CONNECTION'
  | 'DB_TIMEOUT'
  | 'DB_POOL_EXHAUSTED'
  | 'REDIS_CONNECTION'
  | 'REDIS_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'DNS_FAILURE'
  | 'SSL_ERROR'
  | 'FILE_SYSTEM';

/**
 * Vendor error subtypes
 */
export type VendorErrorType =
  | 'STRIPE_API'
  | 'STRIPE_WEBHOOK'
  | 'STRIPE_RATE_LIMIT'
  | 'EMAIL_SERVICE'
  | 'SMS_SERVICE'
  | 'PAYMENT_GATEWAY'
  | 'CDN_ERROR'
  | 'THIRD_PARTY_API';

/**
 * Application error subtypes
 */
export type ApplicationErrorType =
  | 'VALIDATION'
  | 'BUSINESS_LOGIC'
  | 'CONFIGURATION'
  | 'DEPENDENCY_FAILURE'
  | 'CODE_BUG'
  | 'RESOURCE_EXHAUSTED'
  | 'TIMEOUT';

/**
 * Security error subtypes
 */
export type SecurityErrorType =
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'RATE_LIMIT_EXCEEDED'
  | 'XSS_ATTEMPT'
  | 'CSRF_ATTEMPT'
  | 'SQL_INJECTION'
  | 'SUSPICIOUS_ACTIVITY'
  | 'TOKEN_INVALID'
  | 'SESSION_HIJACKING';

/**
 * Client error subtypes
 */
export type ClientErrorType =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA'
  | 'PAYLOAD_TOO_LARGE'
  | 'MALFORMED_JSON'
  | 'MISSING_PARAMETER'
  | 'INVALID_PARAMETER';

/**
 * Union of all error subtypes
 */
export type ErrorSubType = 
  | InfrastructureErrorType 
  | VendorErrorType 
  | ApplicationErrorType 
  | SecurityErrorType 
  | ClientErrorType;

/**
 * Structured error code format: CATEGORY_SUBTYPE
 */
export type TaxonomyErrorCode = 
  // Infrastructure
  | 'INFRA_DB_CONNECTION'
  | 'INFRA_DB_TIMEOUT'
  | 'INFRA_DB_POOL_EXHAUSTED'
  | 'INFRA_REDIS_CONNECTION'
  | 'INFRA_REDIS_TIMEOUT'
  | 'INFRA_NETWORK_ERROR'
  | 'INFRA_DNS_FAILURE'
  | 'INFRA_SSL_ERROR'
  | 'INFRA_FILE_SYSTEM'
  // Vendor
  | 'VENDOR_STRIPE_API'
  | 'VENDOR_STRIPE_WEBHOOK'
  | 'VENDOR_STRIPE_RATE_LIMIT'
  | 'VENDOR_EMAIL_SERVICE'
  | 'VENDOR_SMS_SERVICE'
  | 'VENDOR_PAYMENT_GATEWAY'
  | 'VENDOR_CDN_ERROR'
  | 'VENDOR_THIRD_PARTY_API'
  // Application
  | 'APP_VALIDATION'
  | 'APP_BUSINESS_LOGIC'
  | 'APP_CONFIGURATION'
  | 'APP_DEPENDENCY_FAILURE'
  | 'APP_CODE_BUG'
  | 'APP_RESOURCE_EXHAUSTED'
  | 'APP_TIMEOUT'
  // Security
  | 'SEC_AUTHENTICATION'
  | 'SEC_AUTHORIZATION'
  | 'SEC_RATE_LIMIT_EXCEEDED'
  | 'SEC_XSS_ATTEMPT'
  | 'SEC_CSRF_ATTEMPT'
  | 'SEC_SQL_INJECTION'
  | 'SEC_SUSPICIOUS_ACTIVITY'
  | 'SEC_TOKEN_INVALID'
  | 'SEC_SESSION_HIJACKING'
  // Client
  | 'CLIENT_BAD_REQUEST'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_METHOD_NOT_ALLOWED'
  | 'CLIENT_UNSUPPORTED_MEDIA'
  | 'CLIENT_PAYLOAD_TOO_LARGE'
  | 'CLIENT_MALFORMED_JSON'
  | 'CLIENT_MISSING_PARAMETER'
  | 'CLIENT_INVALID_PARAMETER';

/**
 * Error taxonomy metadata
 */
export interface ErrorTaxonomyMetadata {
  code: TaxonomyErrorCode;
  category: ErrorCategory;
  subType: ErrorSubType;
  severity: ErrorSeverity;
  httpStatus: number;
  description: string;
  alertThreshold: number; // errors per minute before alerting
  escalationDelay: number; // minutes before escalating
}

/**
 * Complete error taxonomy registry
 */
export const ERROR_TAXONOMY: Record<TaxonomyErrorCode, ErrorTaxonomyMetadata> = {
  // Infrastructure Errors
  INFRA_DB_CONNECTION: {
    code: 'INFRA_DB_CONNECTION',
    category: 'INFRASTRUCTURE',
    subType: 'DB_CONNECTION',
    severity: 'critical',
    httpStatus: 503,
    description: 'Database connection failure',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  INFRA_DB_TIMEOUT: {
    code: 'INFRA_DB_TIMEOUT',
    category: 'INFRASTRUCTURE',
    subType: 'DB_TIMEOUT',
    severity: 'high',
    httpStatus: 504,
    description: 'Database query timeout',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  INFRA_DB_POOL_EXHAUSTED: {
    code: 'INFRA_DB_POOL_EXHAUSTED',
    category: 'INFRASTRUCTURE',
    subType: 'DB_POOL_EXHAUSTED',
    severity: 'critical',
    httpStatus: 503,
    description: 'Database connection pool exhausted',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  INFRA_REDIS_CONNECTION: {
    code: 'INFRA_REDIS_CONNECTION',
    category: 'INFRASTRUCTURE',
    subType: 'REDIS_CONNECTION',
    severity: 'high',
    httpStatus: 503,
    description: 'Redis connection failure',
    alertThreshold: 3,
    escalationDelay: 10,
  },
  INFRA_REDIS_TIMEOUT: {
    code: 'INFRA_REDIS_TIMEOUT',
    category: 'INFRASTRUCTURE',
    subType: 'REDIS_TIMEOUT',
    severity: 'medium',
    httpStatus: 504,
    description: 'Redis operation timeout',
    alertThreshold: 10,
    escalationDelay: 15,
  },
  INFRA_NETWORK_ERROR: {
    code: 'INFRA_NETWORK_ERROR',
    category: 'INFRASTRUCTURE',
    subType: 'NETWORK_ERROR',
    severity: 'medium',
    httpStatus: 502,
    description: 'Network connectivity issue',
    alertThreshold: 10,
    escalationDelay: 15,
  },
  INFRA_DNS_FAILURE: {
    code: 'INFRA_DNS_FAILURE',
    category: 'INFRASTRUCTURE',
    subType: 'DNS_FAILURE',
    severity: 'high',
    httpStatus: 503,
    description: 'DNS resolution failure',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  INFRA_SSL_ERROR: {
    code: 'INFRA_SSL_ERROR',
    category: 'INFRASTRUCTURE',
    subType: 'SSL_ERROR',
    severity: 'critical',
    httpStatus: 525,
    description: 'SSL/TLS handshake failure',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  INFRA_FILE_SYSTEM: {
    code: 'INFRA_FILE_SYSTEM',
    category: 'INFRASTRUCTURE',
    subType: 'FILE_SYSTEM',
    severity: 'high',
    httpStatus: 500,
    description: 'File system operation failure',
    alertThreshold: 3,
    escalationDelay: 10,
  },

  // Vendor Errors
  VENDOR_STRIPE_API: {
    code: 'VENDOR_STRIPE_API',
    category: 'VENDOR',
    subType: 'STRIPE_API',
    severity: 'high',
    httpStatus: 502,
    description: 'Stripe API failure',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  VENDOR_STRIPE_WEBHOOK: {
    code: 'VENDOR_STRIPE_WEBHOOK',
    category: 'VENDOR',
    subType: 'STRIPE_WEBHOOK',
    severity: 'medium',
    httpStatus: 400,
    description: 'Stripe webhook processing failure',
    alertThreshold: 10,
    escalationDelay: 15,
  },
  VENDOR_STRIPE_RATE_LIMIT: {
    code: 'VENDOR_STRIPE_RATE_LIMIT',
    category: 'VENDOR',
    subType: 'STRIPE_RATE_LIMIT',
    severity: 'medium',
    httpStatus: 429,
    description: 'Stripe API rate limit hit',
    alertThreshold: 3,
    escalationDelay: 10,
  },
  VENDOR_EMAIL_SERVICE: {
    code: 'VENDOR_EMAIL_SERVICE',
    category: 'VENDOR',
    subType: 'EMAIL_SERVICE',
    severity: 'medium',
    httpStatus: 502,
    description: 'Email service failure',
    alertThreshold: 10,
    escalationDelay: 20,
  },
  VENDOR_SMS_SERVICE: {
    code: 'VENDOR_SMS_SERVICE',
    category: 'VENDOR',
    subType: 'SMS_SERVICE',
    severity: 'low',
    httpStatus: 502,
    description: 'SMS service failure',
    alertThreshold: 20,
    escalationDelay: 30,
  },
  VENDOR_PAYMENT_GATEWAY: {
    code: 'VENDOR_PAYMENT_GATEWAY',
    category: 'VENDOR',
    subType: 'PAYMENT_GATEWAY',
    severity: 'critical',
    httpStatus: 503,
    description: 'Payment gateway failure',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  VENDOR_CDN_ERROR: {
    code: 'VENDOR_CDN_ERROR',
    category: 'VENDOR',
    subType: 'CDN_ERROR',
    severity: 'low',
    httpStatus: 502,
    description: 'CDN service error',
    alertThreshold: 20,
    escalationDelay: 30,
  },
  VENDOR_THIRD_PARTY_API: {
    code: 'VENDOR_THIRD_PARTY_API',
    category: 'VENDOR',
    subType: 'THIRD_PARTY_API',
    severity: 'medium',
    httpStatus: 502,
    description: 'Third-party API failure',
    alertThreshold: 10,
    escalationDelay: 15,
  },

  // Application Errors
  APP_VALIDATION: {
    code: 'APP_VALIDATION',
    category: 'APPLICATION',
    subType: 'VALIDATION',
    severity: 'low',
    httpStatus: 422,
    description: 'Input validation failure',
    alertThreshold: 100,
    escalationDelay: 60,
  },
  APP_BUSINESS_LOGIC: {
    code: 'APP_BUSINESS_LOGIC',
    category: 'APPLICATION',
    subType: 'BUSINESS_LOGIC',
    severity: 'medium',
    httpStatus: 409,
    description: 'Business logic violation',
    alertThreshold: 50,
    escalationDelay: 30,
  },
  APP_CONFIGURATION: {
    code: 'APP_CONFIGURATION',
    category: 'APPLICATION',
    subType: 'CONFIGURATION',
    severity: 'high',
    httpStatus: 500,
    description: 'Application configuration error',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  APP_DEPENDENCY_FAILURE: {
    code: 'APP_DEPENDENCY_FAILURE',
    category: 'APPLICATION',
    subType: 'DEPENDENCY_FAILURE',
    severity: 'high',
    httpStatus: 503,
    description: 'Required dependency unavailable',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  APP_CODE_BUG: {
    code: 'APP_CODE_BUG',
    category: 'APPLICATION',
    subType: 'CODE_BUG',
    severity: 'high',
    httpStatus: 500,
    description: 'Unexpected code error/bug',
    alertThreshold: 10,
    escalationDelay: 15,
  },
  APP_RESOURCE_EXHAUSTED: {
    code: 'APP_RESOURCE_EXHAUSTED',
    category: 'APPLICATION',
    subType: 'RESOURCE_EXHAUSTED',
    severity: 'critical',
    httpStatus: 503,
    description: 'Application resources exhausted',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  APP_TIMEOUT: {
    code: 'APP_TIMEOUT',
    category: 'APPLICATION',
    subType: 'TIMEOUT',
    severity: 'medium',
    httpStatus: 504,
    description: 'Application timeout',
    alertThreshold: 10,
    escalationDelay: 15,
  },

  // Security Errors
  SEC_AUTHENTICATION: {
    code: 'SEC_AUTHENTICATION',
    category: 'SECURITY',
    subType: 'AUTHENTICATION',
    severity: 'medium',
    httpStatus: 401,
    description: 'Authentication failure',
    alertThreshold: 50,
    escalationDelay: 30,
  },
  SEC_AUTHORIZATION: {
    code: 'SEC_AUTHORIZATION',
    category: 'SECURITY',
    subType: 'AUTHORIZATION',
    severity: 'medium',
    httpStatus: 403,
    description: 'Authorization failure',
    alertThreshold: 30,
    escalationDelay: 30,
  },
  SEC_RATE_LIMIT_EXCEEDED: {
    code: 'SEC_RATE_LIMIT_EXCEEDED',
    category: 'SECURITY',
    subType: 'RATE_LIMIT_EXCEEDED',
    severity: 'low',
    httpStatus: 429,
    description: 'Rate limit exceeded',
    alertThreshold: 100,
    escalationDelay: 60,
  },
  SEC_XSS_ATTEMPT: {
    code: 'SEC_XSS_ATTEMPT',
    category: 'SECURITY',
    subType: 'XSS_ATTEMPT',
    severity: 'high',
    httpStatus: 400,
    description: 'Potential XSS attack detected',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  SEC_CSRF_ATTEMPT: {
    code: 'SEC_CSRF_ATTEMPT',
    category: 'SECURITY',
    subType: 'CSRF_ATTEMPT',
    severity: 'high',
    httpStatus: 403,
    description: 'Potential CSRF attack detected',
    alertThreshold: 5,
    escalationDelay: 10,
  },
  SEC_SQL_INJECTION: {
    code: 'SEC_SQL_INJECTION',
    category: 'SECURITY',
    subType: 'SQL_INJECTION',
    severity: 'critical',
    httpStatus: 400,
    description: 'SQL injection attempt detected',
    alertThreshold: 1,
    escalationDelay: 5,
  },
  SEC_SUSPICIOUS_ACTIVITY: {
    code: 'SEC_SUSPICIOUS_ACTIVITY',
    category: 'SECURITY',
    subType: 'SUSPICIOUS_ACTIVITY',
    severity: 'medium',
    httpStatus: 403,
    description: 'Suspicious activity detected',
    alertThreshold: 20,
    escalationDelay: 20,
  },
  SEC_TOKEN_INVALID: {
    code: 'SEC_TOKEN_INVALID',
    category: 'SECURITY',
    subType: 'TOKEN_INVALID',
    severity: 'low',
    httpStatus: 401,
    description: 'Invalid or expired token',
    alertThreshold: 100,
    escalationDelay: 60,
  },
  SEC_SESSION_HIJACKING: {
    code: 'SEC_SESSION_HIJACKING',
    category: 'SECURITY',
    subType: 'SESSION_HIJACKING',
    severity: 'critical',
    httpStatus: 403,
    description: 'Potential session hijacking detected',
    alertThreshold: 1,
    escalationDelay: 5,
  },

  // Client Errors
  CLIENT_BAD_REQUEST: {
    code: 'CLIENT_BAD_REQUEST',
    category: 'CLIENT',
    subType: 'BAD_REQUEST',
    severity: 'info',
    httpStatus: 400,
    description: 'Bad request from client',
    alertThreshold: 1000,
    escalationDelay: 0, // No escalation for client errors
  },
  CLIENT_NOT_FOUND: {
    code: 'CLIENT_NOT_FOUND',
    category: 'CLIENT',
    subType: 'NOT_FOUND',
    severity: 'info',
    httpStatus: 404,
    description: 'Resource not found',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
  CLIENT_METHOD_NOT_ALLOWED: {
    code: 'CLIENT_METHOD_NOT_ALLOWED',
    category: 'CLIENT',
    subType: 'METHOD_NOT_ALLOWED',
    severity: 'info',
    httpStatus: 405,
    description: 'HTTP method not allowed',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
  CLIENT_UNSUPPORTED_MEDIA: {
    code: 'CLIENT_UNSUPPORTED_MEDIA',
    category: 'CLIENT',
    subType: 'UNSUPPORTED_MEDIA',
    severity: 'info',
    httpStatus: 415,
    description: 'Unsupported media type',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
  CLIENT_PAYLOAD_TOO_LARGE: {
    code: 'CLIENT_PAYLOAD_TOO_LARGE',
    category: 'CLIENT',
    subType: 'PAYLOAD_TOO_LARGE',
    severity: 'low',
    httpStatus: 413,
    description: 'Request payload too large',
    alertThreshold: 100,
    escalationDelay: 30,
  },
  CLIENT_MALFORMED_JSON: {
    code: 'CLIENT_MALFORMED_JSON',
    category: 'CLIENT',
    subType: 'MALFORMED_JSON',
    severity: 'info',
    httpStatus: 400,
    description: 'Malformed JSON in request body',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
  CLIENT_MISSING_PARAMETER: {
    code: 'CLIENT_MISSING_PARAMETER',
    category: 'CLIENT',
    subType: 'MISSING_PARAMETER',
    severity: 'info',
    httpStatus: 400,
    description: 'Missing required parameter',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
  CLIENT_INVALID_PARAMETER: {
    code: 'CLIENT_INVALID_PARAMETER',
    category: 'CLIENT',
    subType: 'INVALID_PARAMETER',
    severity: 'info',
    httpStatus: 400,
    description: 'Invalid parameter value',
    alertThreshold: 1000,
    escalationDelay: 0,
  },
};

/**
 * Get error metadata by code
 */
export function getErrorMetadata(code: TaxonomyErrorCode): ErrorTaxonomyMetadata {
  const metadata = ERROR_TAXONOMY[code];
  if (!metadata) {
    throw new Error(`Unknown error code: ${code}`);
  }
  return metadata;
}

/**
 * Check if error category requires immediate escalation
 */
export function isEscalationRequired(category: ErrorCategory, severity: ErrorSeverity): boolean {
  return category === 'INFRASTRUCTURE' || category === 'SECURITY' || severity === 'critical';
}

/**
 * Get severity level numeric value (for comparison)
 */
export function getSeverityValue(severity: ErrorSeverity): number {
  const values: Record<ErrorSeverity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };
  return values[severity];
}

/**
 * Get all error codes for a category
 */
export function getErrorCodesByCategory(category: ErrorCategory): TaxonomyErrorCode[] {
  return Object.values(ERROR_TAXONOMY)
    .filter((meta) => meta.category === category)
    .map((meta) => meta.code);
}

/**
 * Get default error code for HTTP status
 */
export function getDefaultErrorCode(statusCode: number): TaxonomyErrorCode {
  const mapping: Record<number, TaxonomyErrorCode> = {
    400: 'CLIENT_BAD_REQUEST',
    401: 'SEC_AUTHENTICATION',
    403: 'SEC_AUTHORIZATION',
    404: 'CLIENT_NOT_FOUND',
    405: 'CLIENT_METHOD_NOT_ALLOWED',
    409: 'APP_BUSINESS_LOGIC',
    413: 'CLIENT_PAYLOAD_TOO_LARGE',
    415: 'CLIENT_UNSUPPORTED_MEDIA',
    422: 'APP_VALIDATION',
    429: 'SEC_RATE_LIMIT_EXCEEDED',
    500: 'APP_CODE_BUG',
    502: 'INFRA_NETWORK_ERROR',
    503: 'INFRA_DB_CONNECTION',
    504: 'APP_TIMEOUT',
  };
  return mapping[statusCode] || 'APP_CODE_BUG';
}
