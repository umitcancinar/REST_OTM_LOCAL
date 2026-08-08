const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.log("No tenant found");
    return;
  }
  
  await prisma.printerConfig.deleteMany({});
  console.log("Deleted old printers");

  await prisma.printerConfig.createMany({
    data: [
      {
        tenantId: tenant.id,
        name: 'Adisyon',
        type: 'RECEIPT',
        ipAddress: '192.168.1.100', // Example placeholder, user can edit
        port: 9100,
        departments: ['CASHIER'],
        isActive: true,
      },
      {
        tenantId: tenant.id,
        name: 'Fırın',
        type: 'KITCHEN',
        ipAddress: '192.168.1.203',
        port: 9100,
        departments: ['KITCHEN', 'COLD', 'PASTRY'],
        isActive: true,
      },
      {
        tenantId: tenant.id,
        name: 'Izgara',
        type: 'MANGAL',
        ipAddress: '192.168.1.202',
        port: 9100,
        departments: ['GRILL'],
        isActive: true,
      }
    ]
  });
  console.log("Created 3 default printers");
}

main().catch(console.error).finally(() => prisma.$disconnect());
