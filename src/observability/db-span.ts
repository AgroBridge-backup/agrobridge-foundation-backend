import { context, trace } from '@opentelemetry/api';

import { loadEnv } from '../config/env.js';
import { requestContext } from './request-context.js';
import { semconv } from './semconv.js';

// Minimal DB span helper.
//
// Goals:
// - capture operation timing consistently
// - avoid collecting PII / SQL payloads
// - keep span cardinality low (model + operation only)

export async function withDbSpan<T>(input: {
  name: string;
  model?: string;
  operation?: string;
  fn: () => Promise<T>;
}): Promise<T> {
  const tracer = trace.getTracer('agrobridge.db');

  return tracer.startActiveSpan(input.name, async (span) => {
    const startedAt = Date.now();
    try {
      span.setAttribute(semconv.ATTR_DB_SYSTEM, 'postgresql');
      if (input.model) span.setAttribute(semconv.ATTR_DB_MODEL, input.model);
      if (input.operation) span.setAttribute(semconv.ATTR_DB_OPERATION, input.operation);

      const res = await input.fn();
      const durationMs = Date.now() - startedAt;
      span.setAttribute(semconv.ATTR_DB_DURATION_MS, durationMs);

      // Elite ops: emit a log line for slow DB spans, correlated by traceId.
      // Do NOT include SQL or parameters.
      const threshold = loadEnv().DB_SLOW_MS ?? (process.env.NODE_ENV === 'production' ? 250 : 0);
      if (threshold > 0 && durationMs >= threshold) {
        const traceId = activeTraceId();
        const log = requestContext.getLog();

        if (log) {
          log.warn(
            {
              traceId,
              span: input.name,
              model: input.model,
              operation: input.operation,
              durationMs,
              thresholdMs: threshold,
            },
            'slow db operation',
          );
        } else {
          // Fallback for non-request contexts (e.g., scripts).
           
          console.warn(
            JSON.stringify({
              level: 'warn',
              msg: 'slow db operation',
              traceId,
              span: input.name,
              model: input.model,
              operation: input.operation,
              durationMs,
              thresholdMs: threshold,
            }),
          );
        }
      }

      return res;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      span.setAttribute(semconv.ATTR_DB_DURATION_MS, durationMs);
      span.recordException(err as Error);
      span.setStatus({ code: semconv.SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Helper for creating child spans without changing parent context.
export function activeTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId;
}
