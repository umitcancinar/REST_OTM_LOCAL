// ==========================================
// Prisma Database Client (Singleton)
// ==========================================

import { PrismaClient } from '@prisma/client';
import { env } from './env';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDev ? ['query', 'warn', 'error'] : ['error'],
  });

if (!env.isProd) {
  globalForPrisma.prisma = prisma;
}

export default prisma;
