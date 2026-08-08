import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("Tenant not found");
  
  // 1. Clear all existing tables
  await prisma.restaurantTable.deleteMany({
    where: { tenantId: tenant.id }
  });
  console.log("Deleted all existing tables.");

  // 2. Create Salon (S1-S30)
  const salonTables = [];
  for (let i = 1; i <= 30; i++) {
    salonTables.push({
      tenantId: tenant.id,
      number: `S${i}`,
      zone: 'SALON',
      capacity: 4,
      status: 'AVAILABLE'
    });
  }

  // 3. Create Teras (T1-T30)
  const terasTables = [];
  for (let i = 1; i <= 30; i++) {
    terasTables.push({
      tenantId: tenant.id,
      number: `T${i}`,
      zone: 'TERAS',
      capacity: 4,
      status: 'AVAILABLE'
    });
  }

  // 4. Create VIP (V1-V20)
  const vipTables = [];
  for (let i = 1; i <= 20; i++) {
    vipTables.push({
      tenantId: tenant.id,
      number: `V${i}`,
      zone: 'VIP',
      capacity: 6,
      status: 'AVAILABLE'
    });
  }

  const allTables = [...salonTables, ...terasTables, ...vipTables];
  for (const table of allTables) {
    await prisma.restaurantTable.create({
      data: table
    });
  }

  console.log(`Created 30 Salon (S1-S30), 30 Teras (T1-T30), 20 VIP (V1-V20) tables.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
