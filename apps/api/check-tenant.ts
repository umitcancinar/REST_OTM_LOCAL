import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tenant = await prisma.tenant.findFirst();
  console.log("Tenant Settings Type:", typeof tenant?.settings);
  console.log("Tenant Settings:");
  console.log(JSON.stringify(tenant?.settings, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
