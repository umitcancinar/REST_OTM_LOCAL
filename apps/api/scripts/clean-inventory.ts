import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("Tenant not found");

  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' }
  });

  const seen = new Set();
  let deletedCount = 0;

  for (const item of items) {
    if (seen.has(item.name)) {
      // It's a duplicate, delete it
      await prisma.inventoryItem.delete({
        where: { id: item.id }
      });
      deletedCount++;
      console.log(`Deleted duplicate: ${item.name}`);
    } else {
      // Keep the first one
      seen.add(item.name);
    }
  }

  console.log(`Finished. Deleted ${deletedCount} duplicate inventory items.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
