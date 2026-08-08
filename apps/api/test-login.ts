import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'umitcancinar1@gmail.com';
  const password = 'fiRbux-temja9-vyjqux';

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } }
  });

  console.log("User found:", user);

  if (user) {
    const isValid = await bcrypt.compare(password, user.passwordHash);
    console.log("Password valid:", isValid);
  }
}

main().finally(() => prisma.$disconnect());
