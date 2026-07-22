import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  configureFounderNotifier,
  notifyFounderIfCritical,
} from '../../../src/observability/founder-notifier.js';

/**
 * Minimal founder-notification: fire-and-forget webhook on CRITICAL errors,
 * debounced per error code. These tests pin the gates + debounce + isolation
 * (a notification failure must never escape into the request path).
 */
const CRITICAL = {
  severity: 'critical' as const,
  code: 'INFRA_DB_CONNECTION',
  message: 'Database connection failed',
  requestId: 'req-1',
  endpoint: '/api/donations/intent',
};

describe('founder-notifier', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    configureFounderNotifier('https://hook.test/critical'); // also clears debounce state
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    configureFounderNotifier(undefined); // disable + reset
  });

  test('POSTs when configured + critical', () => {
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST' });
    const body = JSON.parse((init as RequestInit).body as string);
    // Send both `text` and `content` for Slack/Discord/Google Chat compatibility.
    expect(body.text).toContain('INFRA_DB_CONNECTION');
    expect(body.text).toContain('/api/donations/intent');
    expect(body.content).toBe(body.text);
    expect(body.requestId).toBe('req-1');
  });

  test('no-op when severity is not critical', () => {
    notifyFounderIfCritical({ ...CRITICAL, severity: 'high' });
    notifyFounderIfCritical({ ...CRITICAL, severity: 'low' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('debounces the same code within the cooldown window', () => {
    notifyFounderIfCritical(CRITICAL);
    notifyFounderIfCritical(CRITICAL);
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('sends again after the cooldown elapses', () => {
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Within cooldown -> still one.
    vi.advanceTimersByTime(60_000);
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the 5-minute cooldown -> second notification.
    vi.advanceTimersByTime(5 * 60_000);
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('different error codes do not debounce each other', () => {
    notifyFounderIfCritical(CRITICAL);
    notifyFounderIfCritical({ ...CRITICAL, code: 'VENDOR_STRIPE_API' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('a transport failure is swallowed (never throws into the caller)', () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    expect(() => notifyFounderIfCritical(CRITICAL)).not.toThrow();
  });

  test('no-op when unconfigured', () => {
    configureFounderNotifier(undefined);
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('blank/whitespace URL is treated as unconfigured', () => {
    configureFounderNotifier('   ');
    notifyFounderIfCritical(CRITICAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
