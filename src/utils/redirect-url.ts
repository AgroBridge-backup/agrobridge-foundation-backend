import type { Env } from '../config/env.js';

const DEV_REDIRECT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost:3000',
  'https://127.0.0.1:3000',
];

type RedirectLogger = {
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
};

type ValidateRedirectUrlInput = {
  candidateUrl: string | undefined;
  defaultUrl: string;
  allowedOrigins: string[];
  requireHttps: boolean;
  fieldName: string;
  allowedPathPrefixes?: string[];
  log?: RedirectLogger;
};

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  for (const value of raw.split(',')) {
    const origin = normalizeOrigin(value);
    if (!origin) continue;
    seen.add(origin);
  }

  return Array.from(seen);
}

function isAllowedPath(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getAllowedDonationRedirectOrigins(
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGIN' | 'DONATION_REDIRECT_ORIGINS'>,
): string[] {
  const configured = parseOriginList(env.DONATION_REDIRECT_ORIGINS);
  const fromCors = parseOriginList(env.CORS_ORIGIN);

  const allowed = configured.length > 0 ? configured : fromCors;
  if (env.NODE_ENV === 'production') {
    return allowed;
  }

  const merged = new Set<string>(allowed);
  for (const origin of DEV_REDIRECT_ORIGINS) {
    merged.add(origin);
  }
  return Array.from(merged);
}

export function validateRedirectUrl({
  candidateUrl,
  defaultUrl,
  allowedOrigins,
  requireHttps,
  fieldName,
  allowedPathPrefixes = [],
  log,
}: ValidateRedirectUrlInput): string {
  if (!candidateUrl) return defaultUrl;

  try {
    const parsed = new URL(candidateUrl);

    if (parsed.username || parsed.password) {
      throw new Error('Credentials in URL are not allowed');
    }

    if (!allowedOrigins.includes(parsed.origin)) {
      throw new Error(`Origin "${parsed.origin}" is not allowlisted`);
    }

    if (requireHttps && parsed.protocol !== 'https:') {
      throw new Error('HTTPS is required in production');
    }

    if (!requireHttps && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only HTTP(S) protocols are allowed');
    }

    if (allowedPathPrefixes.length > 0 && !isAllowedPath(parsed.pathname, allowedPathPrefixes)) {
      throw new Error(`Path "${parsed.pathname}" is not allowed`);
    }

    return parsed.toString();
  } catch (err) {
    log?.warn?.(
      {
        fieldName,
        candidateUrl,
        fallbackUrl: defaultUrl,
        reason: err instanceof Error ? err.message : 'unknown',
      },
      'Rejected untrusted donation redirect URL; using default',
    );
    return defaultUrl;
  }
}
