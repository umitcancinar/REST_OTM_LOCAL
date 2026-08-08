const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL tanimli degil. Baglanti testi calistirilmadi.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  console.log('Veritabani baglantisi basarili.');
}

main()
  .catch((error) => {
    console.error('Veritabani baglantisi basarisiz:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
