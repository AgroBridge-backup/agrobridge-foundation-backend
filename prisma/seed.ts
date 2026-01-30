import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const email = requireEnv('ADMIN_EMAIL').toLowerCase().trim();
  const password = requireEnv('ADMIN_PASSWORD');
  const role = (process.env.ADMIN_ROLE || 'ADMIN') as 'ADMIN' | 'SUPER_ADMIN';

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash, role },
    update: { passwordHash, role },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
     
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
