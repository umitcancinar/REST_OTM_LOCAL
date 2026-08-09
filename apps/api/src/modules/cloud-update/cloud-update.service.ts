import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import {
  type UpdateManifest,
  updateMigrationSchema,
} from '../local-update/local-update.contract';
import {
  CloudUpdatePublisherError,
  assertPublishableManifest,
  selectEligiblePublishedRelease,
  signUpdateManifest,
  verifyStoredEnvelope,
  type StoredPublishedEnvelope,
} from './cloud-update.publisher';
import type {
  CreateCloudUpdateReleaseInput,
  ListCloudUpdateReleasesInput,
} from './cloud-update.validation';

export interface UpdateAuditContext {
  operatorId: string;
  ipAddress?: string;
  userAgent?: string;
}

function notFound(): CloudUpdatePublisherError {
  return new CloudUpdatePublisherError('UPDATE_RELEASE_NOT_FOUND', 'Update release bulunamadi.', 404);
}

function serializeRelease<T extends { artifacts?: Array<{ sizeBytes: bigint }> }>(release: T) {
  const { artifacts, ...rest } = release;
  if (!artifacts) return rest;
  return {
    ...rest,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      sizeBytes: Number(artifact.sizeBytes),
    })),
  };
}

function auditData(context: UpdateAuditContext) {
  return {
    operatorId: context.operatorId,
    ipAddress: context.ipAddress?.slice(0, 64),
    userAgent: context.userAgent?.slice(0, 512),
  };
}

function manifestFromRelease(release: {
  version: string;
  channel: string;
  minCurrentVersion: string;
  maxCurrentVersion: string;
  issuedAt: Date;
  expiresAt: Date;
  migration: Prisma.JsonValue;
  artifacts: Array<{
    role: string;
    fileName: string;
    platform: string;
    sha256: string;
    sizeBytes: bigint;
    sourceUrl: string;
  }>;
}): UpdateManifest {
  return {
    schemaVersion: 1,
    version: release.version,
    channel: release.channel,
    minCurrentVersion: release.minCurrentVersion,
    maxCurrentVersion: release.maxCurrentVersion,
    issuedAt: release.issuedAt.toISOString(),
    expiresAt: release.expiresAt.toISOString(),
    migration: updateMigrationSchema.parse(release.migration),
    artifacts: release.artifacts.map((artifact) => ({
      role: artifact.role as UpdateManifest['artifacts'][number]['role'],
      fileName: artifact.fileName,
      platform: artifact.platform as 'win32-x64',
      sha256: artifact.sha256,
      sizeBytes: Number(artifact.sizeBytes),
      url: artifact.sourceUrl,
    })),
  };
}

export const cloudUpdateService = {
  async create(input: CreateCloudUpdateReleaseInput, context: UpdateAuditContext) {
    // Full local-consumer schema and origin policy are checked before any row is written.
    const manifest: UpdateManifest = {
      schemaVersion: 1,
      ...input,
    };
    assertPublishableManifest(
      manifest,
      new Set(cloudEnv.UPDATE_ARTIFACT_ALLOWED_ORIGINS),
    );

    const created = await prisma.$transaction(async (tx) => tx.updateRelease.create({
      data: {
        version: input.version,
        channel: input.channel,
        minCurrentVersion: input.minCurrentVersion,
        maxCurrentVersion: input.maxCurrentVersion,
        issuedAt: new Date(input.issuedAt),
        expiresAt: new Date(input.expiresAt),
        migration: input.migration as unknown as Prisma.InputJsonObject,
        createdBy: context.operatorId,
        artifacts: {
          create: input.artifacts.map((artifact, position) => ({
            position,
            role: artifact.role,
            fileName: artifact.fileName,
            platform: artifact.platform,
            sha256: artifact.sha256,
            sizeBytes: BigInt(artifact.sizeBytes),
            sourceUrl: artifact.url,
          })),
        },
        auditLogs: {
          create: {
            ...auditData(context),
            action: 'CREATED',
            metadata: {
              version: input.version,
              channel: input.channel,
              artifactCount: input.artifacts.length,
            },
          },
        },
      },
      include: { artifacts: { orderBy: { position: 'asc' } } },
    }));
    return serializeRelease(created);
  },

  async list(input: ListCloudUpdateReleasesInput) {
    const where = {
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.updateRelease.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: { artifacts: { orderBy: { position: 'asc' } } },
      }),
      prisma.updateRelease.count({ where }),
    ]);
    return {
      items: items.map(serializeRelease),
      total,
      page: input.page,
      limit: input.limit,
    };
  },

  async detail(id: string) {
    const release = await prisma.updateRelease.findUnique({
      where: { id },
      include: {
        artifacts: { orderBy: { position: 'asc' } },
        auditLogs: { orderBy: { timestamp: 'desc' }, take: 100 },
      },
    });
    if (!release) throw notFound();
    return serializeRelease(release);
  },

  async publish(id: string, context: UpdateAuditContext) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
      const release = await tx.updateRelease.findUnique({
        where: { id },
        include: { artifacts: { orderBy: { position: 'asc' } } },
      });
      if (!release) throw notFound();
      if (release.status !== 'DRAFT') {
        throw new CloudUpdatePublisherError(
          'UPDATE_RELEASE_NOT_DRAFT',
          'Yalniz DRAFT release yayinlanabilir.',
        );
      }
      const signed = signUpdateManifest(
        manifestFromRelease(release),
        cloudEnv.UPDATE_SIGNING_PRIVATE_KEY,
        new Set(cloudEnv.UPDATE_ARTIFACT_ALLOWED_ORIGINS),
      );
      const changed = await tx.updateRelease.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'PUBLISHED',
          manifestPayload: signed.envelope.payload,
          signature: signed.envelope.signature,
          manifestSha256: signed.digest,
          publishedAt: new Date(),
        },
      });
      if (changed.count !== 1) {
        throw new CloudUpdatePublisherError('UPDATE_RELEASE_RACE', 'Release yayinlama yarisi reddedildi.');
      }
      await tx.updateReleaseAuditLog.create({
        data: {
          releaseId: id,
          ...auditData(context),
          action: 'PUBLISHED',
          metadata: { manifestSha256: signed.digest },
        },
      });
    });
    return this.detail(id);
  },

  async revoke(id: string, reason: string, context: UpdateAuditContext) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
      const release = await tx.updateRelease.findUnique({ where: { id } });
      if (!release) throw notFound();
      if (release.status !== 'PUBLISHED') {
        throw new CloudUpdatePublisherError(
          'UPDATE_RELEASE_NOT_PUBLISHED',
          'Yalniz PUBLISHED release geri cekilebilir.',
        );
      }
      await tx.updateRelease.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.updateReleaseAuditLog.create({
        data: {
          releaseId: id,
          ...auditData(context),
          action: 'REVOKED',
          metadata: { reason },
        },
      });
    });
    return this.detail(id);
  },

  async manifestFor(currentVersion: string, channel: string, now = new Date()) {
    const rows = await prisma.updateRelease.findMany({
      where: {
        status: 'PUBLISHED',
        channel,
        issuedAt: { lte: now },
        expiresAt: { gt: now },
      },
      take: 500,
    });
    const eligible = selectEligiblePublishedRelease(
      rows as StoredPublishedEnvelope[],
      currentVersion,
      channel,
      now,
    );
    if (!eligible) return null;
    const envelope = verifyStoredEnvelope(eligible, cloudEnv.UPDATE_SIGNING_PUBLIC_KEY);
    return { envelope, releaseId: eligible.id, version: eligible.version };
  },
};
