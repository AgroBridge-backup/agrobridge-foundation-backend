import path from 'node:path';
import type { PrismaConfig } from 'prisma/config';

// Prisma 7 configuration
// Database URL is now passed directly to PrismaClient constructor in src/db/prisma.ts
const config: PrismaConfig = {
  schema: path.join(__dirname, 'schema.prisma'),
};

export default config;
