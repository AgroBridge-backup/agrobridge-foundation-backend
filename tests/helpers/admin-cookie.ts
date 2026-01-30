import type { FastifyInstance } from 'fastify';

// Creates a signed cookie value using Fastify's cookie signer.
// This avoids brittle manual signing logic and keeps tests accurate.
export async function signAdminCookie(app: FastifyInstance, jwt: string): Promise<string> {
  // cookie plugin decorates app with unsignCookie/signCookie
  const signed = (app as any).signCookie(jwt);
  return `ab_admin=${signed}; Path=/; HttpOnly; SameSite=Lax`;
}
