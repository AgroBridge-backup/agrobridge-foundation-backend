import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadEnv, type Env } from '../../src/config/env.js';

describe('loadEnv', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid environment', () => {
    process.env = {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'very-secret-key-at-least-32-chars',
      COOKIE_SECRET: 'cookie-secret-key-16',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      STRIPE_API_VERSION: '2024-01-01',
      CORS_ORIGIN: 'https://example.com',
    };

    const env = loadEnv();

    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
  });

  it('should throw error on missing required fields', () => {
    process.env = {
      NODE_ENV: 'production',
      PORT: '3000',
      JWT_SECRET: 'very-secret-key-at-least-32-chars',
      COOKIE_SECRET: 'cookie-secret-key-16',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      STRIPE_API_VERSION: '2024-01-01',
      CORS_ORIGIN: 'https://example.com',
    };

    expect(() => loadEnv()).toThrow('Invalid environment:');
  });

  it('should throw error on invalid NODE_ENV', () => {
    process.env = {
      ...getValidEnv(),
      NODE_ENV: 'invalid' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on invalid PORT', () => {
    process.env = {
      ...getValidEnv(),
      PORT: '999999' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on invalid PORT (not a number)', () => {
    process.env = {
      ...getValidEnv(),
      PORT: 'not-a-number' as any,
    } as any;

    expect(() => loadEnv()).toThrow();
  });

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on invalid DATABASE_URL', () => {
    process.env = {
      ...getValidEnv(),
      DATABASE_URL: '' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on JWT_SECRET too short', () => {
    process.env = {
      ...getValidEnv(),
      JWT_SECRET: 'short' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on COOKIE_SECRET too short', () => {
    process.env = {
      ...getValidEnv(),
      COOKIE_SECRET: 'short' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should throw error on invalid OTEL_EXPORTER_OTLP_ENDPOINT URL', () => {
    process.env = {
      ...getValidEnv(),
      OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

  it('should apply defaults', () => {
    process.env = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_SECRET: 'very-secret-key-at-least-32-chars',
      COOKIE_SECRET: 'cookie-secret-key-16',
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      STRIPE_API_VERSION: '2024-01-01',
      CORS_ORIGIN: 'https://example.com',
    };

    const env = loadEnv();

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('should handle optional OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    const envWithoutOtel = {
      ...getValidEnv(),
    };
    delete envWithoutOtel.OTEL_EXPORTER_OTLP_ENDPOINT;

    process.env = envWithoutOtel;

    const env = loadEnv();

    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('should handle optional DB_SLOW_MS', () => {
    const envWithoutSlowMs = {
      ...getValidEnv(),
    };
    delete envWithoutSlowMs.DB_SLOW_MS;

    process.env = envWithoutSlowMs;

    const env = loadEnv();

    expect(env.DB_SLOW_MS).toBeUndefined();
  });

  it('should validate DB_SLOW_MS is positive', () => {
    process.env = {
      ...getValidEnv(),
      DB_SLOW_MS: '-100' as any,
    };

    expect(() => loadEnv()).toThrow();
  });

function getValidEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'very-secret-key-at-least-32-chars',
    COOKIE_SECRET: 'cookie-secret-key-16',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
    STRIPE_API_VERSION: '2024-01-01',
    CORS_ORIGIN: 'https://example.com',
  };
}
