import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ─── 1. Create Super Admin ────────────────
  const superAdminHash = await bcrypt.hash('fiRbux-temja9-vyjqux', 12);
  let superAdmin = await prisma.user.findFirst({
    where: { email: 'umitcancinar1@gmail.com' },
  });

  if (superAdmin) {
    superAdmin = await prisma.user.update({
      where: { id: superAdmin.id },
      data: { passwordHash: superAdminHash },
    });
  } else {
    superAdmin = await prisma.user.create({
      data: {
        email: 'umitcancinar1@gmail.com',
        passwordHash: superAdminHash,
        name: 'Süper Admin',
        role: Role.SUPER_ADMIN,
      },
    });
  }

  console.log(`✅ Super Admin: ${superAdmin.email} created or updated.`);

  // ─── 2. System Settings ───────────────────
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      defaultCurrency: 'TRY',
      defaultTimezone: 'Europe/Istanbul',
      allowSignup: true,
      maintenanceMode: false,
    },
  });
  console.log('✅ System Settings initialized.');

  // ─── 3. WIPE ALL OLD PINs ────────
  try {
    const res = await prisma.user.updateMany({
      data: { pin: null }
    });
    console.log(`✅ Temporary Fix: Wiped ${res.count} old corrupted PINs from the database.`);
  } catch (e) {
    console.error('Error applying temporary fix for wiping PINs:', e);
  }

  console.log('\n======================================================');
  console.log('✅ SEED COMPLETED SUCCESSFULLY');
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
