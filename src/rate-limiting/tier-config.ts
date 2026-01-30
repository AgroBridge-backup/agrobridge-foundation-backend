import { z } from 'zod';

export enum RateLimitTier {
  PUBLIC = 'public',
  ADMIN = 'admin',
  WEBHOOK = 'webhook',
  STRICT = 'strict',
  ABUSE = 'abuse',
  VIP_ADMIN = 'vip_admin',
  API_KEY = 'api_key',
  DDOS = 'ddos',
}

export interface TierConfig {
  tier: RateLimitTier;
  maxRequests: number;
  timeWindow: string;
  skipOnError?: boolean;
  allowList?: string[];
  blockList?: string[];
}

export const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  [RateLimitTier.PUBLIC]: {
    tier: RateLimitTier.PUBLIC,
    maxRequests: 300,
    timeWindow: '1 minute',
  },
  [RateLimitTier.ADMIN]: {
    tier: RateLimitTier.ADMIN,
    maxRequests: 100,
    timeWindow: '1 minute',
  },
  [RateLimitTier.WEBHOOK]: {
    tier: RateLimitTier.WEBHOOK,
    maxRequests: 500,
    timeWindow: '1 minute',
    skipOnError: true,
  },
  [RateLimitTier.STRICT]: {
    tier: RateLimitTier.STRICT,
    maxRequests: 20,
    timeWindow: '1 minute',
  },
  [RateLimitTier.ABUSE]: {
    tier: RateLimitTier.ABUSE,
    maxRequests: 5,
    timeWindow: '1 minute',
  },
  [RateLimitTier.VIP_ADMIN]: {
    tier: RateLimitTier.VIP_ADMIN,
    maxRequests: 500,
    timeWindow: '1 minute',
  },
  [RateLimitTier.API_KEY]: {
    tier: RateLimitTier.API_KEY,
    maxRequests: 1000,
    timeWindow: '1 minute',
  },
  [RateLimitTier.DDOS]: {
    tier: RateLimitTier.DDOS,
    maxRequests: 10,
    timeWindow: '1 minute',
  },
};

export const ROUTE_TIERS: Record<string, RateLimitTier> = {
  '/api/health': RateLimitTier.PUBLIC,
  '/api/donations/intent': RateLimitTier.PUBLIC,
  '/api/contacts': RateLimitTier.PUBLIC,
  '/api/auth/login': RateLimitTier.STRICT,
  '/api/admin/donations': RateLimitTier.ADMIN,
  '/api/admin/dashboard': RateLimitTier.ADMIN,
  '/api/webhooks/stripe': RateLimitTier.WEBHOOK,
};

export function getTierForRoute(route: string): RateLimitTier {
  return ROUTE_TIERS[route] || RateLimitTier.PUBLIC;
}

export function isBlockedIP(ip: string, tier: RateLimitTier): boolean {
  const config = TIER_CONFIGS[tier];
  return config.blockList?.includes(ip) ?? false;
}

export function isAllowedIP(ip: string, tier: RateLimitTier): boolean {
  const config = TIER_CONFIGS[tier];
  return config.allowList?.includes(ip) ?? false;
}
