/**
 * Error Observability Middleware for AgroBridge Foundation
 * 
 * Automatic error classification and metrics collection
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import Stripe from 'stripe';
import { AppError } from '../errors/app-error.js';
import {
  type TaxonomyErrorCode,
  type ErrorCategory,
  type ErrorSeverity,
  getDefaultErrorCode,
  getErrorMetadata,
  ERROR_TAXONOMY,
} from '../errors/error-taxonomy.js';
import {
  recordError,
  recordInfrastructureError,
  startClassificationTimer,
  getCurrentErrorRate,
} from '../observability/error-metrics.js';
import { notifyFounderIfCritical } from '../observability/founder-notifier.js';
import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';

/**
 * Extended error information for observability
 */
export interface ErrorContext {
  requestId: string;
  endpoint: string;
  method: string;
  userId: string | undefined;
  userType: 'anonymous' | 'authenticated' | 'admin';
  ip: string | undefined;
  userAgent: string | undefined;
  timestamp: Date;
  latencyMs: number;
}

/**
 * Classified error result
 */
export interface ClassifiedError {
  code: TaxonomyErrorCode;
  category: ErrorCategory;
  severity: ErrorSeverity;
  httpStatus: number;
  message: string;
  shouldAlert: boolean;
  shouldEscalate: boolean;
}

/**
 * Classify an error and return structured information
 */
export function classifyError(
  err: Error | FastifyError,
  context: ErrorContext
): ClassifiedError {
  const endTimer = startClassificationTimer('automatic');

  try {
    // Check for known error types
    const classification = performClassification(err, context);
    
    // Check if we should alert based on rate
    const currentRate = getCurrentErrorRate(classification.category, classification.severity);
    const metadata = getErrorMetadata(classification.code);
    
    const shouldAlert = currentRate >= metadata.alertThreshold;
    const shouldEscalate = shouldAlert && metadata.escalationDelay > 0;

    return {
      ...classification,
      shouldAlert,
      shouldEscalate,
    };
  } finally {
    endTimer();
  }
}

/**
 * Perform the actual error classification
 */
function performClassification(
  err: Error | FastifyError,
  context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  // 1. Check for Prisma/Database errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return classifyPrismaError(err, context);
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      code: 'INFRA_DB_CONNECTION',
      category: 'INFRASTRUCTURE',
      severity: 'critical',
      httpStatus: 503,
      message: 'Database connection failed',
    };
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      code: 'INFRA_DB_CONNECTION',
      category: 'INFRASTRUCTURE',
      severity: 'critical',
      httpStatus: 503,
      message: 'Database engine panic',
    };
  }

  // 2. Check for Stripe errors
  if (err instanceof Stripe.errors.StripeError) {
    return classifyStripeError(err, context);
  }

  // 3. Check for Zod validation errors
  if (err instanceof ZodError) {
    return {
      code: 'APP_VALIDATION',
      category: 'APPLICATION',
      severity: 'low',
      httpStatus: 422,
      message: 'Validation failed: ' + err.issues.map((i) => i.message).join(', '),
    };
  }

  // 4. Check for AppError (our custom errors)
  if (err instanceof AppError) {
    return classifyAppError(err, context);
  }

  // 5. Check for Fastify errors (validation, etc.)
  const fastifyErr = err as FastifyError;
  if (fastifyErr.statusCode) {
    return classifyFastifyError(fastifyErr, context);
  }

  // 6. Check for network/infrastructure errors by message patterns
  if (isInfrastructureError(err)) {
    return classifyInfrastructureError(err, context);
  }

  // 7. Default to application bug
  return {
    code: 'APP_CODE_BUG',
    category: 'APPLICATION',
    severity: 'high',
    httpStatus: 500,
    message: err.message || 'Unknown error',
  };
}

/**
 * Classify Prisma errors
 */
function classifyPrismaError(
  err: Prisma.PrismaClientKnownRequestError,
  _context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  const code = err.code;

  // Connection errors
  if (code.startsWith('P10')) {
    return {
      code: 'INFRA_DB_CONNECTION',
      category: 'INFRASTRUCTURE',
      severity: 'critical',
      httpStatus: 503,
      message: `Database connection error: ${code}`,
    };
  }

  // Timeout errors
  if (code === 'P2024') {
    return {
      code: 'INFRA_DB_TIMEOUT',
      category: 'INFRASTRUCTURE',
      severity: 'high',
      httpStatus: 504,
      message: 'Database query timeout',
    };
  }

  // Not found errors.
  // NOTE: P2025 is "An operation failed because it depends on one or more
  // records that were required but not found." A prior branch here mapped
  // P2025 to INFRA_DB_POOL_EXHAUSTED/503, which shadowed this block and
  // caused legitimate 404s to surface as infrastructure 503s. There is no
  // distinct Prisma "pool exhausted" code; pool pressure surfaces as P2024
  // (handled above as a timeout) or a P10xx connection error.
  if (code === 'P2025') {
    return {
      code: 'CLIENT_NOT_FOUND',
      category: 'CLIENT',
      severity: 'info',
      httpStatus: 404,
      message: 'Resource not found',
    };
  }

  // Unique constraint violations (business logic)
  if (code === 'P2002') {
    return {
      code: 'APP_BUSINESS_LOGIC',
      category: 'APPLICATION',
      severity: 'medium',
      httpStatus: 409,
      message: 'Resource already exists',
    };
  }

  // Foreign key constraint failures
  if (code === 'P2003') {
    return {
      code: 'APP_BUSINESS_LOGIC',
      category: 'APPLICATION',
      severity: 'medium',
      httpStatus: 422,
      message: 'Referenced resource does not exist',
    };
  }

  // Default database error
  return {
    code: 'INFRA_DB_CONNECTION',
    category: 'INFRASTRUCTURE',
    severity: 'high',
    httpStatus: 503,
    message: `Database error: ${code}`,
  };
}

/**
 * Classify Stripe errors
 */
function classifyStripeError(
  err: Stripe.errors.StripeError,
  _context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  const type = err.type;

  // Rate limit errors
  if (type === 'StripeRateLimitError') {
    return {
      code: 'VENDOR_STRIPE_RATE_LIMIT',
      category: 'VENDOR',
      severity: 'medium',
      httpStatus: 429,
      message: 'Stripe rate limit exceeded',
    };
  }

  // Connection errors
  if (type === 'StripeConnectionError') {
    return {
      code: 'VENDOR_STRIPE_API',
      category: 'VENDOR',
      severity: 'high',
      httpStatus: 502,
      message: 'Stripe API connection failed',
    };
  }

  // API errors (invalid requests, etc.)
  if (type === 'StripeInvalidRequestError') {
    return {
      code: 'APP_BUSINESS_LOGIC',
      category: 'APPLICATION',
      severity: 'medium',
      httpStatus: 400,
      message: err.message || 'Invalid request to Stripe',
    };
  }

  // Card errors (customer issues)
  if (type === 'StripeCardError') {
    return {
      code: 'APP_BUSINESS_LOGIC',
      category: 'APPLICATION',
      severity: 'low',
      httpStatus: 402,
      message: err.message || 'Payment declined',
    };
  }

  // Default Stripe error
  return {
    code: 'VENDOR_STRIPE_API',
    category: 'VENDOR',
    severity: 'high',
    httpStatus: 502,
    message: err.message || 'Stripe API error',
  };
}

/**
 * Classify AppError instances
 */
function classifyAppError(
  err: AppError,
  _context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  // Map AppError codes to taxonomy codes
  const codeMap: Record<string, TaxonomyErrorCode> = {
    VALIDATION_ERROR: 'APP_VALIDATION',
    UNAUTHORIZED: 'SEC_AUTHENTICATION',
    FORBIDDEN: 'SEC_AUTHORIZATION',
    NOT_FOUND: 'CLIENT_NOT_FOUND',
    CONFLICT: 'APP_BUSINESS_LOGIC',
    INTERNAL_ERROR: 'APP_CODE_BUG',
  };

  const taxonomyCode = codeMap[err.code] || 'APP_CODE_BUG';
  const metadata = getErrorMetadata(taxonomyCode);

  return {
    code: taxonomyCode,
    category: metadata.category,
    severity: metadata.severity,
    httpStatus: err.statusCode || metadata.httpStatus,
    message: err.message,
  };
}

/**
 * Classify Fastify errors
 */
function classifyFastifyError(
  err: FastifyError,
  _context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  const statusCode = err.statusCode || 500;

  // Use the default mapping
  const taxonomyCode = getDefaultErrorCode(statusCode);
  const metadata = getErrorMetadata(taxonomyCode);

  return {
    code: taxonomyCode,
    category: metadata.category,
    severity: metadata.severity,
    httpStatus: statusCode,
    message: err.message || metadata.description,
  };
}

/**
 * Check if error is infrastructure-related based on message patterns
 */
function isInfrastructureError(err: Error): boolean {
  const patterns = [
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /ECONNRESET/i,
    /EAI_AGAIN/i,
    /socket hang up/i,
    /network error/i,
    /redis/i,
    /database/i,
    /connection/i,
    /timeout/i,
    /dns/i,
    /ssl/i,
    /certificate/i,
  ];

  const message = err.message || '';
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * Classify infrastructure errors by message
 */
function classifyInfrastructureError(
  err: Error,
  _context: ErrorContext
): Omit<ClassifiedError, 'shouldAlert' | 'shouldEscalate'> {
  const message = err.message.toLowerCase();

  if (message.includes('redis')) {
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        code: 'INFRA_REDIS_TIMEOUT',
        category: 'INFRASTRUCTURE',
        severity: 'medium',
        httpStatus: 504,
        message: err.message,
      };
    }
    return {
      code: 'INFRA_REDIS_CONNECTION',
      category: 'INFRASTRUCTURE',
      severity: 'high',
      httpStatus: 503,
      message: err.message,
    };
  }

  if (message.includes('dns') || message.includes('enotfound')) {
    return {
      code: 'INFRA_DNS_FAILURE',
      category: 'INFRASTRUCTURE',
      severity: 'high',
      httpStatus: 503,
      message: err.message,
    };
  }

  if (message.includes('ssl') || message.includes('certificate')) {
    return {
      code: 'INFRA_SSL_ERROR',
      category: 'INFRASTRUCTURE',
      severity: 'critical',
      httpStatus: 525,
      message: err.message,
    };
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      code: 'APP_TIMEOUT',
      category: 'APPLICATION',
      severity: 'medium',
      httpStatus: 504,
      message: err.message,
    };
  }

  return {
    code: 'INFRA_NETWORK_ERROR',
    category: 'INFRASTRUCTURE',
    severity: 'medium',
    httpStatus: 502,
    message: err.message,
  };
}

/**
 * Handle error with full observability
 * This is the main entry point for error handling
 */
export function handleErrorWithObservability(
  err: Error | FastifyError,
  req: FastifyRequest,
  reply: FastifyReply
): ClassifiedError {
  const startTime = Date.now();

  // Build error context
  const userAgent = req.headers['user-agent'];
  const context: ErrorContext = {
    requestId: req.id,
    endpoint: req.url,
    method: req.method,
    userId: (req.user as any)?.id,
    userType: req.user ? 'authenticated' : 'anonymous',
    ip: req.ip,
    userAgent: userAgent || undefined,
    timestamp: new Date(),
    latencyMs: Date.now() - startTime,
  };

  // Classify the error
  const classified = classifyError(err, context);

  // Record metrics
  recordError({
    category: classified.category,
    code: classified.code,
    severity: classified.severity,
    endpoint: context.endpoint,
    userId: context.userId || undefined,
    userType: context.userType || 'anonymous',
    latencyMs: context.latencyMs,
  });

  // Record infrastructure correlation if applicable
  if (classified.category === 'INFRASTRUCTURE') {
    recordInfrastructureError(
      classified.code.split('_')[1] || 'unknown',
      context.endpoint,
      classified.code
    );
  }

  // Update OpenTelemetry span
  const span = trace.getSpan(otelContext.active());
  if (span) {
    span.setAttribute('error.code', classified.code);
    span.setAttribute('error.category', classified.category);
    span.setAttribute('error.severity', classified.severity);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: classified.message,
    });
  }

  // Log with structured context
  req.log.error({
    err,
    errorCode: classified.code,
    errorCategory: classified.category,
    errorSeverity: classified.severity,
    requestId: context.requestId,
    endpoint: context.endpoint,
    shouldAlert: classified.shouldAlert,
    shouldEscalate: classified.shouldEscalate,
  }, `Error [${classified.code}] ${classified.message}`);

  // Page the founder on critical errors (fire-and-forget, severity-gated,
  // debounced). Donation-pipeline / DB / Stripe outages surface here.
  notifyFounderIfCritical({
    severity: classified.severity,
    code: classified.code,
    message: classified.message,
    requestId: context.requestId,
    endpoint: context.endpoint,
  });

  return classified;
}

/**
 * Get error taxonomy for documentation/monitoring
 */
export function getErrorTaxonomy(): typeof ERROR_TAXONOMY {
  return ERROR_TAXONOMY;
}

/**
 * Get errors by category for filtering
 */
export function getErrorsByCategory(
  category: ErrorCategory
): Array<{ code: TaxonomyErrorCode; metadata: (typeof ERROR_TAXONOMY)[TaxonomyErrorCode] }> {
  return Object.entries(ERROR_TAXONOMY)
    .filter(([, metadata]) => metadata.category === category)
    .map(([code, metadata]) => ({ code: code as TaxonomyErrorCode, metadata }));
}
