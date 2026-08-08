import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.printerConfig.findMany().then(console.log);
