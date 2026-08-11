import bcrypt from 'bcryptjs';
import type { LicensePayload } from '@rest-otm/license';
import { randomBytes } from 'crypto';
import prisma from '../../config/database';
import { localEnv } from '../../config/env.local';
import { sharedEnv } from '../../config/env.shared';
import { issueAccessToken } from '../auth/auth.service';

const BOOTSTRAP_EMAIL = '__first_setup__@local.invalid';

export interface LocalSetupSession {
  accessToken: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    role: 'OWNER';
    sessionType: 'local_setup';
  };
}

export async function isLocalInstallationReady(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      isActive: true,
      printAgentSecret: true,
      users: {
        where: {
          role: { in: ['OWNER', 'ADMIN'] },
          isActive: true,
          email: { not: BOOTSTRAP_EMAIL },
        },
        take: 1,
        select: { id: true },
      },
    },
  });
  return Boolean(
    tenant?.isActive
    && tenant.printAgentSecret === localEnv.PRINT_AGENT_SECRET
    && tenant.users.length === 1,
  );
}

export async function provisionLocalInstallation(
  license: LicensePayload,
): Promise<LocalSetupSession | undefined> {
  const safeId = license.tenantId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
  const slug = `local-${safeId || 'restaurant'}`;
  const bootstrapPasswordHash = await bcrypt.hash(
    randomBytes(48).toString('base64url'),
    sharedEnv.BCRYPT_SALT_ROUNDS,
  );

  const setupUser = await prisma.$transaction(async (tx) => {
    await tx.tenant.upsert({
      where: { id: license.tenantId },
      create: {
        id: license.tenantId,
        name: license.restaurantName,
        slug,
        isActive: true,
        subscriptionExpiresAt: new Date(license.expiresAt),
        printAgentSecret: localEnv.PRINT_AGENT_SECRET,
      },
      update: {
        name: license.restaurantName,
        isActive: true,
        subscriptionExpiresAt: new Date(license.expiresAt),
        printAgentSecret: localEnv.PRINT_AGENT_SECRET,
      },
    });

    const existingManager = await tx.user.findFirst({
      where: {
        tenantId: license.tenantId,
        role: { in: ['OWNER', 'ADMIN'] },
        isActive: true,
        email: { not: BOOTSTRAP_EMAIL },
      },
      select: { id: true },
    });
    if (existingManager) return undefined;

    return tx.user.upsert({
      where: {
        tenantId_email: { tenantId: license.tenantId, email: BOOTSTRAP_EMAIL },
      },
      create: {
        tenantId: license.tenantId,
        email: BOOTSTRAP_EMAIL,
        name: 'Ilk Kurulum',
        role: 'OWNER',
        passwordHash: bootstrapPasswordHash,
        isActive: true,
      },
      update: {
        passwordHash: bootstrapPasswordHash,
        isActive: true,
      },
      select: { id: true },
    });
  });

  if (!setupUser) return undefined;
  const user = {
    id: setupUser.id,
    tenantId: license.tenantId,
    email: BOOTSTRAP_EMAIL,
    name: 'Ilk Kurulum',
    role: 'OWNER' as const,
    sessionType: 'local_setup' as const,
  };
  return {
    accessToken: issueAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      sessionType: user.sessionType,
    }, '15m'),
    user,
  };
}
