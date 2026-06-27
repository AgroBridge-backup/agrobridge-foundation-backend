import type { ErrorSeverity } from '../errors/error-taxonomy.js';
import { requestContext } from './request-context.js';

/**
 * Minimal founder notification.
 *
 * When a CRITICAL error occurs (DB down, Stripe API failure, donation pipeline
 * breaking), fire-and-forget a single POST to a webhook so a solo-founded
 * nonprofit learns immediately — without watching dashboards.
 *
 * Design choices:
 * - Webhook transport (native `fetch`, zero dependencies). Point
 *   `FOUNDER_NOTIFY_WEBHOOK_URL` at a free Slack / Discord / Google Chat
 *   incoming webhook. The body sends BOTH `text` and `content`, so it renders
 *   correctly in all three (Slack/Google Chat use `text`, Discord uses `content`).
 * - Severity-gated to `critical` (edit NOTIFY_SEVERITIES to widen).
 * - Per-code cooldown debounce: one notification per error code per window.
 *   A 500-message storm is worse than no alert.
 * - Fire-and-forget: never awaited by callers, never throws into the request
 *   path. If the transport fails, it is logged once and swallowed.
 * - No-op entirely when no webhook URL is configured.
 *
 * The debounce map is in-memory (per-process). On the single-instance Render
 * deploy this is exact; a multi-instance deploy would over-send slightly —
 * acceptable for a founder-facing pager of last resort.
 */

const NOTIFY_SEVERITIES: ReadonlySet<ErrorSeverity> = new Set(['critical']);
const COOLDOWN_MS = 5 * 60 * 1000; // one notification per code per 5 minutes
const SEND_TIMEOUT_MS = 5_000;

let webhookUrl: string | undefined;
const lastSentAt = new Map<string, number>();

/** Configure (or clear with undefined) the destination webhook. Idempotent. */
export function configureFounderNotifier(url: string | undefined): void {
  webhookUrl = url && url.trim() ? url.trim() : undefined;
  lastSentAt.clear();
}

interface CriticalEvent {
  severity: ErrorSeverity;
  code: string;
  message: string;
  requestId?: string;
  endpoint?: string;
}

/**
 * Notify the founder of a critical event, subject to severity + debounce gates.
 * Safe to call from the request hot path — it never awaits or throws.
 */
export function notifyFounderIfCritical(event: CriticalEvent): void {
  if (!webhookUrl) return;
  if (!NOTIFY_SEVERITIES.has(event.severity)) return;

  const now = Date.now();
  const last = lastSentAt.get(event.code);
  if (last !== undefined && now - last < COOLDOWN_MS) return;
  lastSentAt.set(event.code, now);

  // Fire-and-forget. A notification failure must NEVER break the request.
  void post(webhookUrl, event).catch((err) => {
    requestContext.getLog()?.warn(
      { err, code: event.code },
      'founder notification delivery failed (suppressed)',
    );
  });
}

async function post(url: string, event: CriticalEvent): Promise<void> {
  const where = event.endpoint ? ` @ ${event.endpoint}` : '';
  const line = `[AGROBRIDGE ALERT] [${event.severity.toUpperCase()}] ${event.code}${where} (req ${event.requestId ?? 'n/a'})\n${event.message}`;
  const body = {
    text: line, // Slack, Google Chat
    content: line, // Discord
    severity: event.severity,
    code: event.code,
    endpoint: event.endpoint,
    requestId: event.requestId,
    timestamp: new Date().toISOString(),
  };
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
}
