import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

// Creates a signed cookie value using Fastify's cookie signer.
// This avoids brittle manual signing logic and keeps tests accurate.
export async function signAdminCookie(app: FastifyInstance, jwt: string): Promise<string> {
  // cookie plugin decorates app with unsignCookie/signCookie
  const signed = (app as any).signCookie(jwt);
  return `ab_admin=${signed}; Path=/; HttpOnly; SameSite=Lax`;
}

// Creates a test admin user and returns a signed auth cookie for admin routes.
export async function getAdminCookie(app: FastifyInstance): Promise<string> {
  const email = `admin-${Date.now()}@agrobridge.org`;
  const passwordHash = await bcrypt.hash('test-password', 10);

  const admin = await (app as any).prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
    },
  });

  const token = await (app as any).jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role },
    { expiresIn: '1h' },
  );

  return signAdminCookie(app, token);
}
