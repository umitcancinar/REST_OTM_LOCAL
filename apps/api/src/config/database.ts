// ==========================================
// Prisma Database Client (Singleton)
// ==========================================

import { PrismaClient } from '@prisma/client';
import { sharedEnv } from './env.shared';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: sharedEnv.isDev ? ['query', 'warn', 'error'] : ['error'],
  });

if (!sharedEnv.isProd) {
  globalForPrisma.prisma = prisma;
}

export default prisma;
