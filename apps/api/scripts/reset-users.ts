// ==========================================
// User Credentials Reset Script
// ==========================================
// Kullanım:
//   DATABASE_URL=<url> OWNER_PASSWORD='...' WAITER_PASSWORD='...' \
//     npx ts-node scripts/reset-users.ts
//
// Sifreler ARTIK kodda yazili degil. Onceki surumde musterinin gercek
// sifreleri bu dosyada duz metin duruyordu ve git gecmisine islenmisti;
// repoya erisimi olan herkes restoranin hesabina girebilirdi.

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const MIN_LENGTH = 12;

/** Uretim verisine yazacak bir betikte varsayilan sifre olmamali. */
function requirePassword(varName: string): string {
  const value = process.env[varName];
  if (!value) {
    console.error(`\n❌ ${varName} tanımlı değil. Örnek:\n   ${varName}='...' npx ts-node scripts/reset-users.ts\n`);
    process.exit(1);
  }
  if (value.length < MIN_LENGTH) {
    console.error(`\n❌ ${varName} çok kısa — en az ${MIN_LENGTH} karakter olmalı.\n`);
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log('🔑 Kullanıcı bilgileri güncelleniyor...\n');

  // Tenant'ı bul
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'lezzet-restoran' },
  });

  if (!tenant) {
    console.error('❌ Tenant bulunamadı! Önce seed çalıştırın.');
    process.exit(1);
  }

  console.log(`✅ Tenant: ${tenant.name} (${tenant.slug})\n`);

  // ─── 1. OWNER (Patron / Yönetici) ────────────────────────────────
  const ownerEmail    = 'muratusta@tarihiadanakebapcisi.com';
  const ownerPassword = requirePassword('OWNER_PASSWORD');
  const ownerHash     = await bcrypt.hash(ownerPassword, 12);

  // Eski patron@lezzet.com kullanıcısını bul ve güncelle (varsa)
  const existingOwner = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      role: Role.OWNER,
    },
  });

  if (existingOwner) {
    await prisma.user.update({
      where: { id: existingOwner.id },
      data: {
        email: ownerEmail,
        passwordHash: ownerHash,
        name: 'Murat Usta',
      },
    });
    console.log(`✅ Owner güncellendi:`);
  } else {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ownerEmail,
        passwordHash: ownerHash,
        name: 'Murat Usta',
        role: Role.OWNER,
      },
    });
    console.log(`✅ Owner oluşturuldu:`);
  }
  console.log(`   📧 E-posta : ${ownerEmail}`);
  console.log(`   🔒 Şifre   : ${ownerPassword}\n`);

  // ─── 2. WAITER (Garson / Numan Usta) ─────────────────────────────
  const waiterEmail    = 'numanusta@tarihiadanakebapcisi.com';
  const waiterPassword = requirePassword('WAITER_PASSWORD');
  const waiterHash     = await bcrypt.hash(waiterPassword, 12);

  // İlk garson kullanıcısını bul ve güncelle
  const existingWaiter = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      role: Role.WAITER,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (existingWaiter) {
    await prisma.user.update({
      where: { id: existingWaiter.id },
      data: {
        email: waiterEmail,
        passwordHash: waiterHash,
        name: 'Numan Usta',
        pin: '6900',
      },
    });
    console.log(`✅ Garson güncellendi:`);
  } else {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: waiterEmail,
        passwordHash: waiterHash,
        name: 'Numan Usta',
        role: Role.WAITER,
        pin: '6900',
      },
    });
    console.log(`✅ Garson oluşturuldu:`);
  }
  console.log(`   📧 E-posta : ${waiterEmail}`);
  console.log(`   🔒 Şifre   : ${waiterPassword}`);
  console.log(`   🔢 PIN     : 6900\n`);

  console.log('✨ Tamamlandı! Yeni giriş bilgileri:');
  console.log('─────────────────────────────────────────────');
  console.log(`👑 Yönetici (Admin Panel):`);
  console.log(`   ${ownerEmail}`);
  console.log(`   ${ownerPassword}`);
  console.log('');
  console.log(`🧑‍🍳 Garson Paneli:`);
  console.log(`   ${waiterEmail}`);
  console.log(`   ${waiterPassword}`);
  console.log(`   PIN: 6900`);
  console.log('─────────────────────────────────────────────');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Hata:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
