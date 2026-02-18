import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  /** Previous JWT secret for zero-downtime rotation. When rotating secrets,
   *  set this to the old JWT_SECRET value so existing tokens still verify
   *  during the rotation window (typically 24h = max token lifetime). */
  JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
  COOKIE_SECRET: z.string().min(16),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_API_VERSION: z.string().min(1),
  CORS_ORIGIN: z.string(),
  DONATION_REDIRECT_ORIGINS: z.string().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Optional OpenTelemetry collector endpoint. Example:
  // http://localhost:4318/v1/traces
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  // Slow DB operation log threshold (ms). Set to a conservative value in prod.
  DB_SLOW_MS: z.coerce.number().int().positive().optional(),
  // Connection pool maximum size. Default: 20.
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  // Connection pool idle timeout in milliseconds. Default: 20000.
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().int().positive().default(20000),
  // Bearer token for Prometheus /metrics endpoint authentication.
  // Required in production; omit in dev for unauthenticated access.
  METRICS_AUTH_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
