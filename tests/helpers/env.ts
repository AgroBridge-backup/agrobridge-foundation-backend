export function setTestEnv(overrides: Record<string, string> = {}) {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.DATABASE_URL = 'postgresql://x:y@localhost:5432/z';
  process.env.JWT_SECRET = 'x'.repeat(32);
  process.env.COOKIE_SECRET = 'y'.repeat(16);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  process.env.STRIPE_API_VERSION = '2024-06-20';
  process.env.CORS_ORIGIN = 'https://example.com,https://secondary.example.com';

  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}
