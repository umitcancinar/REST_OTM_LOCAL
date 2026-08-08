// ==========================================
// SUPER_ADMIN sifre sifirlama
// ==========================================
// Sifre ARTIK kodda yazili degil. Onceki surumde sabit bir sifre
// ('zupqon-...') dosyada duruyordu ve git gecmisine islenmisti; repoya
// erisimi olan herkes butun restoranlari yoneten hesaba girebilirdi.
//
// Kullanim:
//   NEW_PASSWORD='...' npx ts-node scripts/reset-superadmin.ts
// veya sifreyi betigin uretmesini isteyerek:
//   npx ts-node scripts/reset-superadmin.ts --generate

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const MIN_LENGTH = 16;

function resolvePassword(): string {
  if (process.argv.includes('--generate')) {
    return randomBytes(24).toString('base64url');
  }

  const fromEnv = process.env.NEW_PASSWORD;
  if (!fromEnv) {
    console.error(
      '\nNEW_PASSWORD tanimli degil.\n' +
        "  NEW_PASSWORD='...' npx ts-node scripts/reset-superadmin.ts\n" +
        '  veya guclu bir sifre uretmek icin: --generate\n',
    );
    process.exit(1);
  }
  if (fromEnv.length < MIN_LENGTH) {
    console.error(`\nSifre cok kisa — en az ${MIN_LENGTH} karakter olmali.\n`);
    process.exit(1);
  }
  return fromEnv;
}

async function resetSuperAdmin() {
  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });

    if (!superAdmin) {
      console.error('SUPER_ADMIN bulunamadı. Lütfen önce bir SUPER_ADMIN oluşturun.');
      process.exit(1);
    }

    const newPassword = resolvePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: superAdmin.id },
      data: { passwordHash },
    });

    // Acik oturumlar kapatilir: sifre sifirlamanin amaci erisimi kesmektir,
    // eski oturumlar acik kalirsa bu saglanmaz.
    const revoked = await prisma.refreshToken.updateMany({
      where: { userId: superAdmin.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    console.log('✅ SUPER_ADMIN şifresi güncellendi.');
    console.log('   E-posta:', superAdmin.email);
    console.log('   Kapatılan oturum:', revoked.count);
    if (process.argv.includes('--generate')) {
      console.log('\n   Üretilen şifre (bir kez gösterilir, parola yöneticine kaydet):');
      console.log('   ' + newPassword + '\n');
    }
  } catch (error) {
    console.error('Hata oluştu:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetSuperAdmin();
