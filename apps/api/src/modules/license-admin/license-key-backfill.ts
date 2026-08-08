import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import { createLicenseKeyMaterial } from '../license/license-key.policy';

const BATCH_SIZE = 100;

export async function backfillLegacyLicenseKeys(apply: boolean): Promise<{
  found: number;
  migrated: number;
}> {
  const found = await prisma.license.count({ where: { legacyKey: { not: null } } });
  if (!apply || found === 0) return { found, migrated: 0 };

  let migrated = 0;
  while (true) {
    const batch = await prisma.license.findMany({
      where: { legacyKey: { not: null } },
      select: { id: true, legacyKey: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    await prisma.$transaction(
      batch.map((license) => {
        if (!license.legacyKey) throw new Error('Backfill satirinda plaintext anahtar bulunamadi.');
        const material = createLicenseKeyMaterial(
          license.legacyKey,
          cloudEnv.LICENSE_KEY_PEPPER_RING,
        );
        return prisma.license.update({
          where: { id: license.id },
          data: {
            keyHash: material.keyHash,
            keyPepperVersion: material.keyPepperVersion,
            keyLast4: material.keyLast4,
            legacyKey: null,
          },
          select: { id: true },
        });
      }),
    );
    migrated += batch.length;
  }

  return { found, migrated };
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');
  try {
    const result = await backfillLegacyLicenseKeys(apply);
    console.log(
      apply
        ? `License key backfill tamamlandi: ${result.migrated}/${result.found}`
        : `License key backfill dry-run: ${result.found} plaintext kayit; degisiklik yapilmadi.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(`License key backfill basarisiz: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
