import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import {
  type MenuPublicationPayload,
  type MenuPublicationPush,
  menuPublicationPayloadSchema,
  publicationChecksum,
} from '../publication-contract/menu-publication.contract';
import type { CloudMenuSyncIdentity } from './cloud-menu-sync.auth';

export class PublicationConflictError extends Error {
  readonly statusCode = 409;
}

export async function applyMenuPublication(identity: CloudMenuSyncIdentity, publication: MenuPublicationPush) {
  if (publicationChecksum(publication.payload) !== publication.checksum) {
    throw Object.assign(new Error('Publication checksum mismatch'), { statusCode: 422 });
  }
  const canonicalPayload = menuPublicationPayloadSchema.parse({
    ...publication.payload,
    tenant: {
      ...publication.payload.tenant,
      id: identity.publicId,
      name: identity.name,
      slug: identity.slug,
      customDomain: identity.customDomain,
    },
    menu: { ...publication.payload.menu, restaurantName: identity.name },
  }) as MenuPublicationPayload;
  const canonicalChecksum = publicationChecksum(canonicalPayload);
  return prisma.$transaction(async (tx) => {
    // Tenant-scoped xact lock serializes first insert and every later monotonic comparison.
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${identity.tenantId}, 0))
    `);
    const current = await tx.menuPublication.findUnique({ where: { tenantId: identity.tenantId } });
    if (current && publication.version < current.version) {
      throw new PublicationConflictError('Stale publication version');
    }
    if (current && publication.version === current.version) {
      if (publication.checksum !== current.sourceChecksum) {
        throw new PublicationConflictError('Same publication version has a different checksum');
      }
      return {
        version: current.version,
        checksum: current.sourceChecksum,
        publicationChecksum: current.checksum,
        idempotent: true,
      };
    }
    const saved = await tx.menuPublication.upsert({
      where: { tenantId: identity.tenantId },
      update: {
        publicId: identity.publicId,
        slug: identity.slug,
        customDomain: identity.customDomain,
        version: publication.version,
        sourceChecksum: publication.checksum,
        checksum: canonicalChecksum,
        payload: canonicalPayload as unknown as Prisma.InputJsonObject,
        publishedAt: new Date(),
        disabledAt: null,
      },
      create: {
        tenantId: identity.tenantId,
        publicId: identity.publicId,
        slug: identity.slug,
        customDomain: identity.customDomain,
        version: publication.version,
        sourceChecksum: publication.checksum,
        checksum: canonicalChecksum,
        payload: canonicalPayload as unknown as Prisma.InputJsonObject,
        disabledAt: null,
      },
    });
    return {
      version: saved.version,
      checksum: saved.sourceChecksum,
      publicationChecksum: saved.checksum,
      idempotent: false,
    };
  });
}
