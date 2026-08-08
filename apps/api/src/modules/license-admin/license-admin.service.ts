import { Prisma, type LicenseAuditAction } from '@prisma/client';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import { createLicenseKeyMaterial } from '../license/license-key.policy';
import {
  assertNotRevoked,
  extendExpiry,
  generateLicenseKey,
  initialExpiry,
  lifecycleError,
  maskLicenseKeyLast4,
} from './license-admin.policy';
import type {
  CreateLicenseInput,
  ExtendLicenseInput,
  ListLicensesInput,
  RebindLicenseInput,
  UpdateLicenseInput,
} from './license-admin.validation';

const tenantSelect = { id: true, name: true, slug: true } as const;
const presentableLicenseSelect = {
  id: true,
  tenantId: true,
  keyLast4: true,
  status: true,
  hardwareIdShort: true,
  activatedAt: true,
  expiresAt: true,
  graceDays: true,
  features: true,
  lastHeartbeatAt: true,
  lastHeartbeatIp: true,
  appVersion: true,
  suspiciousCount: true,
  lastSuspiciousAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  tenant: { select: tenantSelect },
} as const;
const licenseLifecycleSelect = {
  ...presentableLicenseSelect,
  hardwareId: true,
} as const;

type PresentableLicense = {
  id: string;
  tenantId: string;
  keyLast4: string | null;
  status: string;
  hardwareIdShort: string | null;
  activatedAt: Date | null;
  expiresAt: Date;
  graceDays: number;
  features: string[];
  lastHeartbeatAt: Date | null;
  lastHeartbeatIp: string | null;
  appVersion: string | null;
  suspiciousCount: number;
  lastSuspiciousAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  tenant: { id: string; name: string; slug: string };
};

function present(license: PresentableLicense) {
  const { keyLast4, tenant, ...safe } = license;
  return {
    ...safe,
    restaurantName: tenant.name,
    tenantSlug: tenant.slug,
    keyMasked: maskLicenseKeyLast4(keyLast4),
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  licenseId: string,
  operatorId: string,
  action: LicenseAuditAction,
  metadata: Prisma.InputJsonObject,
) {
  await tx.licenseAuditLog.create({
    data: { licenseId, operatorId, action, metadata },
  });
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
    }
  }
  throw new Error('Transaction retry sınırı aşıldı');
}

async function requireLicense(tx: Prisma.TransactionClient, id: string) {
  const license = await tx.license.findUnique({
    where: { id },
    select: licenseLifecycleSelect,
  });
  if (!license) throw lifecycleError('Lisans bulunamadı.', 404);
  return license;
}

export const licenseAdminService = {
  async list(input: ListLicensesInput) {
    const where: Prisma.LicenseWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.search
        ? {
            OR: [
              { tenant: { name: { contains: input.search, mode: 'insensitive' } } },
              { tenant: { slug: { contains: input.search, mode: 'insensitive' } } },
              { hardwareIdShort: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (input.page - 1) * input.limit;
    const [items, total] = await prisma.$transaction([
      prisma.license.findMany({
        where,
        skip,
        take: input.limit,
        orderBy: { createdAt: 'desc' },
        select: presentableLicenseSelect,
      }),
      prisma.license.count({ where }),
    ]);
    return { items: items.map(present), total, page: input.page, limit: input.limit };
  },

  async detail(id: string) {
    const license = await prisma.license.findUnique({
      where: { id },
      select: {
        ...presentableLicenseSelect,
        auditLogs: { orderBy: { timestamp: 'desc' }, take: 100 },
      },
    });
    if (!license) throw lifecycleError('Lisans bulunamadı.', 404);
    const { auditLogs, ...base } = license;
    return { ...present(base), auditLogs };
  },

  async create(input: CreateLicenseInput, operatorId: string) {
    const expiresAt = initialExpiry(input.durationDays, input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw lifecycleError('Lisans bitiş tarihi gelecekte olmalıdır.', 400);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = generateLicenseKey();
      const keyMaterial = createLicenseKeyMaterial(key, cloudEnv.LICENSE_KEY_PEPPER_RING);
      try {
        const created = await prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.findUnique({
            where: { id: input.tenantId },
            select: { ...tenantSelect, isActive: true },
          });
          if (!tenant) throw lifecycleError('Restoran bulunamadı.', 404);
          if (!tenant.isActive) throw lifecycleError('Pasif restoran için lisans oluşturulamaz.');

          const license = await tx.license.create({
            data: {
              tenantId: input.tenantId,
              keyHash: keyMaterial.keyHash,
              keyLast4: keyMaterial.keyLast4,
              keyPepperVersion: keyMaterial.keyPepperVersion,
              expiresAt,
              graceDays: input.graceDays,
              features: input.features,
              notes: input.notes,
            },
            select: presentableLicenseSelect,
          });
          await audit(tx, license.id, operatorId, 'CREATED', {
            tenantId: input.tenantId,
            expiresAt: expiresAt.toISOString(),
            graceDays: input.graceDays,
            features: input.features,
          });
          return license;
        });
        return { license: present(created), key };
      } catch (error) {
        const collision =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collision) throw error;
        const occupiedSeat = await prisma.license.findFirst({
          where: { tenantId: input.tenantId, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (occupiedSeat) {
          throw lifecycleError(
            'Bu restoranın zaten iptal edilmemiş bir lokal sunucu lisansı var.',
          );
        }
        if (attempt === 4) throw error;
      }
    }
    throw new Error('Lisans anahtarı üretilemedi');
  },

  async update(id: string, input: UpdateLicenseInput, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      const updated = await tx.license.update({
        where: { id },
        data: input,
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'UPDATED', {
        before: {
          graceDays: current.graceDays,
          features: current.features,
          notes: current.notes,
        },
        after: {
          graceDays: updated.graceDays,
          features: updated.features,
          notes: updated.notes,
        },
      });
      return present(updated);
    });
  },

  async extend(id: string, input: ExtendLicenseInput, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      const expiresAt = extendExpiry(current.expiresAt, input.days);
      const updated = await tx.license.update({
        where: { id },
        data: { expiresAt },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'EXTENDED', {
        days: input.days,
        reason: input.reason ?? null,
        previousExpiresAt: current.expiresAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      return present(updated);
    });
  },

  async suspend(id: string, reason: string | undefined, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      if (current.status === 'SUSPENDED') throw lifecycleError('Lisans zaten askıya alınmış.');
      const updated = await tx.license.update({
        where: { id },
        data: { status: 'SUSPENDED' },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'SUSPENDED', {
        previousStatus: current.status,
        reason: reason ?? null,
      });
      return present(updated);
    });
  },

  async resume(id: string, reason: string | undefined, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      if (current.status !== 'SUSPENDED') throw lifecycleError('Yalnız askıdaki lisans devam ettirilebilir.');
      if (current.expiresAt <= new Date()) {
        throw lifecycleError('Süresi dolmuş lisans devam ettirilemez. Önce süreyi uzatın.');
      }
      const status = current.hardwareId ? 'ACTIVE' : 'PENDING';
      const updated = await tx.license.update({
        where: { id },
        data: { status },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'RESUMED', {
        status,
        reason: reason ?? null,
      });
      return present(updated);
    });
  },

  async revoke(id: string, reason: string | undefined, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      const updated = await tx.license.update({
        where: { id },
        data: { status: 'REVOKED' },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'REVOKED', {
        previousStatus: current.status,
        reason: reason ?? null,
      });
      return present(updated);
    });
  },

  async resetActivation(id: string, reason: string | undefined, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      if (!current.hardwareId) throw lifecycleError('Lisans henüz bir cihaza bağlı değil.');
      const status = current.status === 'SUSPENDED' ? 'SUSPENDED' : 'PENDING';
      const updated = await tx.license.update({
        where: { id },
        data: {
          status,
          hardwareId: null,
          hardwareIdShort: null,
          activatedAt: null,
          lastHeartbeatAt: null,
          lastHeartbeatIp: null,
          appVersion: null,
        },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'ACTIVATION_RESET', {
        previousStatus: current.status,
        previousHardwareIdShort: current.hardwareIdShort,
        reason: reason ?? null,
      });
      return present(updated);
    });
  },

  async rebind(id: string, input: RebindLicenseInput, operatorId: string) {
    return serializable(async (tx) => {
      const current = await requireLicense(tx, id);
      assertNotRevoked(current.status);
      if (current.status === 'SUSPENDED') {
        throw lifecycleError('Askıdaki lisans yeni cihaza bağlanamaz. Önce askıyı kaldırın.');
      }
      if (current.expiresAt <= new Date()) {
        throw lifecycleError('Süresi dolmuş lisans bağlanamaz. Önce süreyi uzatın.');
      }
      if (current.hardwareId === input.hardwareId) {
        throw lifecycleError('Lisans zaten bu cihaza bağlı.');
      }
      const updated = await tx.license.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          hardwareId: input.hardwareId.toLowerCase(),
          hardwareIdShort: input.hardwareIdShort ?? null,
          activatedAt: new Date(),
          lastHeartbeatAt: null,
          lastHeartbeatIp: null,
          appVersion: null,
        },
        select: presentableLicenseSelect,
      });
      await audit(tx, id, operatorId, 'REBOUND', {
        previousHardwareIdShort: current.hardwareIdShort,
        hardwareIdShort: input.hardwareIdShort ?? null,
        reason: input.reason ?? null,
      });
      return present(updated);
    });
  },
};
