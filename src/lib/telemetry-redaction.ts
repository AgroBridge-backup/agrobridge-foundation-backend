import { createHash } from 'node:crypto';

/**
 * Hash a potentially-PII value (IP address, email, etc.) into a short, stable,
 * non-reversible digest suitable for use as an OpenTelemetry span attribute or
 * metric label.
 *
 * Returns the first 16 hex chars of SHA-256 — enough for correlation across
 * spans without exposing the underlying PII to the telemetry backend.
 */
export function hashForTelemetry(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
