import { createHmac } from 'crypto';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import {
  licenseKeyHashCandidates,
  normalizeLicenseKey,
} from '../license/license-key.policy';

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
  'RAW_LICENSE_AND_HARDWARE_ID_ARE_REPLAYABLE_WITHOUT_TPM_CHALLENGE;_USE_SHORT_LIVED_SYNC_TOKEN_NEXT' as const;

export function deriveMenuPublicId(tenantId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`menu-public-v1\0${tenantId}`)
    .digest('hex')
    .slice(0, 32);
}

export async function authenticateCloudMenuSync(
  rawLicenseKey: unknown,
  rawHardwareId: unknown,
): Promise<CloudMenuSyncIdentity> {
  if (typeof rawLicenseKey !== 'string' || rawLicenseKey.length < 8 || rawLicenseKey.length > 64) {
    throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 });
  }
  if (typeof rawHardwareId !== 'string' || !/^[a-f0-9]{64}$/i.test(rawHardwareId)) {
    throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 });
  }
  let normalized: string;
  try { normalized = normalizeLicenseKey(rawLicenseKey); }
  catch { throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 }); }
  const hashes = licenseKeyHashCandidates(normalized, cloudEnv.LICENSE_KEY_PEPPER_RING)
    .map((candidate) => candidate.keyHash);
  const license = await prisma.license.findFirst({
    where: {
      OR: [{ keyHash: { in: hashes } }, { legacyKey: normalized }],
    },
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
    || license.status !== 'ACTIVE'
    || license.hardwareId !== rawHardwareId
    || license.expiresAt < now
    || !license.tenant.isActive
  ) {
    throw Object.assign(new Error('Sync credentials invalid'), { statusCode: 401 });
  }
  const publicId = deriveMenuPublicId(license.tenantId, cloudEnv.MENU_PUBLIC_ID_SECRET);
  return {
    tenantId: license.tenantId,
    licenseId: license.id,
    hardwareId: rawHardwareId,
    publicId,
    name: license.tenant.name,
    slug: license.tenant.slug.toLowerCase(),
    customDomain: license.tenant.customDomain?.toLowerCase() || null,
  };
}
