import { trace, Span, SpanStatusCode } from '@opentelemetry/api';
import { RateLimitTier } from '../rate-limiting/tier-config.js';

interface TraceContext {
  traceId?: string | undefined;
  spanId?: string | undefined;
}

interface TracedRateLimitResult<T> {
  result: T;
  span: Span;
  latencyMs: number;
}

export class RateLimitTracer {
  private readonly tracer: ReturnType<typeof trace.getTracer>;
  private readonly serviceName: string;
  private readonly region: string;
  private readonly instanceId: string;

  constructor(
    options: {
      serviceName?: string;
      region?: string;
      instanceId?: string;
    } = {},
  ) {
    this.tracer = trace.getTracer('agrobridge.ratelimit');
    this.serviceName = options.serviceName || process.env.SERVICE_NAME || 'agrobridge-api';
    this.region = options.region || process.env.AWS_REGION || 'unknown';
    this.instanceId = options.instanceId || process.env.INSTANCE_ID || 'unknown';
  }

  getTraceContext(): TraceContext {
    const currentSpan = trace.getActiveSpan();
    const context = currentSpan?.spanContext();
    return {
      traceId: context?.traceId,
      spanId: context?.spanId,
    };
  }

  async withRateLimitContext<T>(
    operation: 'check_limit' | 'increment' | 'get' | 'delete',
    attributes: {
      identifier: string;
      tier: RateLimitTier;
      storeType?: 'redis' | 'in_memory';
      ip?: string;
      route?: string;
      userAgent?: string;
    },
    fn: () => Promise<T>,
  ): Promise<TracedRateLimitResult<T>> {
    const traceContext = this.getTraceContext();
    const startTime = Date.now();

    return this.tracer.startActiveSpan(
      `rate_limit.${operation}`,
      {
        attributes: {
          ...this.getBaseAttributes(),
          ...this.getOperationAttributes(operation, attributes),
          ...this.getTraceAttributes(traceContext),
        },
      },
      async (span) => {
        try {
          const result = await fn();
          const latencyMs = Date.now() - startTime;

          span.setAttribute('rate_limit.success', true);
          span.setAttribute('rate_limit.latency_ms', latencyMs);

          return { result, span, latencyMs };
        } catch (err) {
          const latencyMs = Date.now() - startTime;

          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
          span.setAttribute('rate_limit.success', false);
          span.setAttribute('rate_limit.error_type', err instanceof Error ? err.name : 'unknown');
          span.setAttribute('rate_limit.latency_ms', latencyMs);

          throw err;
        }
      },
    );
  }

  addUpstreamLink(span: Span, upstreamTraceId: string, upstreamSpanId: string): void {
    span.addLink({
      context: {
        traceId: upstreamTraceId,
        spanId: upstreamSpanId,
        traceFlags: 1,
      },
      attributes: {
        'link.type': 'upstream_service',
        'link.direction': 'incoming',
      },
    });
  }

  addDownstreamLink(span: Span, downstreamService: string): void {
    const traceContext = this.getTraceContext();
    if (traceContext.traceId && traceContext.spanId) {
      span.setAttribute('downstream.link.trace_id', traceContext.traceId);
      span.setAttribute('downstream.link.span_id', traceContext.spanId);
      span.setAttribute('downstream.link.service', downstreamService);
    }
  }

  recordRateLimitDecision(
    span: Span,
    decision: {
      allowed: boolean;
      limit: number;
      remaining: number;
      count: number;
    },
  ): void {
    span.setAttribute('rate_limit.allowed', decision.allowed);
    span.setAttribute('rate_limit.limit', decision.limit);
    span.setAttribute('rate_limit.remaining', decision.remaining);
    span.setAttribute('rate_limit.count', decision.count);

    if (!decision.allowed) {
      span.addEvent('rate_limit.exceeded', {
        limit: decision.limit,
        count: decision.count,
        timestamp: Date.now() / 1000,
      });
    }
  }

  recordFallback(span: Span, reason: string, fallbackUsed: boolean): void {
    span.setAttribute('rate_limit.fallback.used', fallbackUsed);
    span.setAttribute('rate_limit.fallback.reason', reason);

    if (fallbackUsed) {
      span.addEvent('rate_limit.fallback.activated', {
        reason,
        timestamp: Date.now() / 1000,
      });
    }
  }

  recordCircuitBreakerState(
    span: Span,
    state: {
      isOpen: boolean;
      failureCount: number;
      cooldownUntil?: Date;
      halfOpenRequests?: number;
    },
  ): void {
    span.setAttribute('circuit_breaker.is_open', state.isOpen);
    span.setAttribute('circuit_breaker.failure_count', state.failureCount);

    if (state.cooldownUntil) {
      span.setAttribute('circuit_breaker.cooldown_until', state.cooldownUntil.toISOString());
    }

    if (state.halfOpenRequests !== undefined) {
      span.setAttribute('circuit_breaker.half_open_requests', state.halfOpenRequests);
    }
  }

  private getBaseAttributes(): Record<string, string | number | boolean> {
    return {
      'service.name': this.serviceName,
      'service.region': this.region,
      'service.instance_id': this.instanceId,
      'service.node_version': process.version,
      'service.pid': process.pid,
    };
  }

  private getOperationAttributes(
    operation: string,
    attributes: {
      identifier: string;
      tier: RateLimitTier;
      storeType?: 'redis' | 'in_memory';
      ip?: string;
      route?: string;
      userAgent?: string;
    },
  ): Record<string, string> {
    const operationAttrs: Record<string, string> = {
      'rate_limit.operation': operation,
      'rate_limit.identifier': this.sanitizeIdentifier(attributes.identifier),
      'rate_limit.tier': attributes.tier,
    };

    if (attributes.storeType) {
      operationAttrs['rate_limit.store_type'] = attributes.storeType;
    }

    if (attributes.ip) {
      operationAttrs['http.client_ip'] = this.hashIp(attributes.ip);
    }

    if (attributes.route) {
      operationAttrs['http.route'] = attributes.route;
    }

    if (attributes.userAgent) {
      operationAttrs['http.user_agent'] = this.sanitizeUserAgent(attributes.userAgent);
    }

    return operationAttrs;
  }

  private getTraceAttributes(traceContext: TraceContext): Record<string, string> {
    const attrs: Record<string, string> = {};

    if (traceContext.traceId) {
      attrs['trace.id'] = traceContext.traceId;
    }

    if (traceContext.spanId) {
      attrs['span.id'] = traceContext.spanId;
    }

    return attrs;
  }

  private sanitizeIdentifier(identifier: string): string {
    if (identifier.length > 64) {
      return identifier.substring(0, 64) + '...';
    }
    return identifier;
  }

  private hashIp(ip: string): string {
    if (ip === 'unknown' || ip.length === 0) {
      return 'unknown';
    }

    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      const char = ip.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private sanitizeUserAgent(userAgent: string): string {
    if (!userAgent) {
      return 'unknown';
    }

    const sanitized = userAgent.replace(/[^\w\s\-\.\/\(\)\[\]]/g, '').substring(0, 128);

    return sanitized || 'unknown';
  }
}

export const rateLimitTracer = new RateLimitTracer();
