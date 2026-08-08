import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const printers = await prisma.printerConfig.findMany();
  console.log(printers.map(p => ({name: p.name, ip: p.ipAddress, port: p.port, depts: p.departments})));
}
main().catch(console.error).finally(() => prisma.$disconnect());
