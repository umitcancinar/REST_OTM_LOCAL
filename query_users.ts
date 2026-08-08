import { PrismaClient } from './apps/api/node_modules/@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });
  console.log(JSON.stringify(users, null, 2));
}
run().finally(() => prisma.$disconnect());
