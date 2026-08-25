/**
 * Redacts obvious PII from a serialized Stripe webhook event before it is
 * persisted for replay/audit.
 *
 * Stripe event JSON embeds donor email, billing address, phone, card
 * fingerprints/BINs, and other customer details. We only need the event
 * id/type, amount, status, and session/subscription ids for debugging, so the
 * known-sensitive objects/leaves are replaced with the literal "[REDACTED]".
 *
 * The pass is intentionally shallow and structural: it walks the parsed JSON
 * and substitutes any key in {@link PII_OBJECT_KEYS} (whole object) or
 * {@link PII_LEAF_KEYS} (scalar value) wherever they appear. Non-sensitive
 * debugging fields (event id, type, amounts, ids, card brand/last4) are
 * preserved.
 *
 * If the payload cannot be parsed as JSON it is returned unchanged so that
 * idempotency bookkeeping never fails on a malformed body.
 */

const PII_OBJECT_KEYS = new Set([
  // checkout.session / charge customer contact + address blobs
  'billing_details',
  'customer_details',
  // shipping contains name, phone, and a full address
  'shipping',
]);

const PII_LEAF_KEYS = new Set([
  // email (Stripe surfaces it under several keys)
  'email',
  'receipt_email',
  'customer_email',
  'customer_name',
  'account_holder_name',
  // contact info
  'phone',
  // card identifiers that can correlate/identify a donor across events
  'fingerprint',
  'bin',
  'network_token_id',
]);

const REDACTED = '[REDACTED]';

function redactNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactNode(entry));
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (PII_OBJECT_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else if (PII_LEAF_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = redactNode(source[key]);
      }
    }
    return out;
  }

  return value;
}

/**
 * Returns a redacted JSON string for the given Stripe event payload. Falls back
 * to the original input if it is not valid JSON (never throws) so that webhook
 * persistence/idempotency remains robust.
 */
export function redactStripePayload(rawPayload: string): string {
  try {
    const parsed = JSON.parse(rawPayload);
    const redacted = redactNode(parsed);
    return JSON.stringify(redacted);
  } catch {
    return rawPayload;
  }
}
