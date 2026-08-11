import { createHmac } from 'crypto';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import {
  licensePublicKeyFromPrivate,
  verifyMenuSyncToken,
} from './cloud-menu-sync-token';

export interface CloudMenuSyncIdentity {
  tenantId: string;
  licenseId: string;
  hardwareId: string;
  publicId: string;
  name: string;
  slug: string;
  customDomain: string | null;
}

export const CLOUD_MENU_SYNC_AUTH_LIMITATION =
  'SHORT_LIVED_SIGNED_TOKEN_LIMITS_REPLAY;_TPM_CNG_CHALLENGE_REQUIRED_FOR_DEVICE_POSSESSION_PROOF' as const;

export function deriveMenuPublicId(tenantId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`menu-public-v1\0${tenantId}`)
    .digest('hex')
    .slice(0, 32);
}

export async function authenticateCloudMenuSync(
  authorization: unknown,
): Promise<CloudMenuSyncIdentity> {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 });
  }
  if (!cloudEnv.LICENSE_PRIVATE_KEY) {
    throw Object.assign(new Error('Sync service unavailable'), { statusCode: 503 });
  }
  const token = authorization.slice('Bearer '.length);
  const grant = verifyMenuSyncToken(
    token,
    licensePublicKeyFromPrivate(cloudEnv.LICENSE_PRIVATE_KEY),
  );
  const license = await prisma.license.findUnique({
    where: { id: grant.licenseId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      hardwareId: true,
      expiresAt: true,
      tenant: {
        select: {
          isActive: true,
          name: true,
          slug: true,
          customDomain: true,
        },
      },
    },
  });
  const now = new Date();
  if (
    !license
    || license.tenantId !== grant.tenantId
    || license.status !== 'ACTIVE'
    || license.hardwareId !== grant.hardwareId
    || license.expiresAt < now
    || !license.tenant.isActive
  ) {
    throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 });
  }
  const publicId = deriveMenuPublicId(license.tenantId, cloudEnv.MENU_PUBLIC_ID_SECRET);
  return {
    tenantId: license.tenantId,
    licenseId: license.id,
    hardwareId: grant.hardwareId,
    publicId,
    name: license.tenant.name,
    slug: license.tenant.slug.toLowerCase(),
    customDomain: license.tenant.customDomain?.toLowerCase() || null,
  };
}
