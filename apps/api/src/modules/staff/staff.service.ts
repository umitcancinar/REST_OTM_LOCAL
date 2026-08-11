// ==========================================
// Staff Service — Business Logic
// ==========================================

import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { sharedEnv } from '../../config/env.shared';

const BOOTSTRAP_EMAIL = '__first_setup__@local.invalid';
type StaffRole = 'WAITER' | 'CASHIER' | 'CHEF' | 'ADMIN' | 'OWNER';

async function assertManagerWillRemain(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  const managers = await tx.user.count({
    where: {
      tenantId,
      role: { in: ['OWNER', 'ADMIN'] },
      isActive: true,
      email: { not: BOOTSTRAP_EMAIL },
      id: { not: userId },
    },
  });
  if (managers === 0) {
    throw Object.assign(new Error('Son aktif yönetici pasif veya yetkisiz bırakılamaz.'), { statusCode: 409 });
  }
}

export const staffService = {
  async findAll(tenantId: string) {
    return prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ['WAITER', 'CHEF', 'CASHIER', 'ADMIN', 'OWNER'] },
        email: { not: BOOTSTRAP_EMAIL },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  },

  async create(tenantId: string, data: {
    name: string;
    email: string;
    password: string;
    role?: StaffRole;
    pin?: string;
  }) {
    // Check email uniqueness within tenant
    const existing = await prisma.user.findFirst({
      where: { tenantId, email: data.email.toLowerCase() },
    });
    if (existing) {
      throw Object.assign(new Error('Bu e-posta adresi zaten kullanılıyor.'), { statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, sharedEnv.BCRYPT_SALT_ROUNDS);
    const pinHash = data.pin ? await bcrypt.hash(data.pin.trim(), sharedEnv.BCRYPT_SALT_ROUNDS) : undefined;

    const role: StaffRole = data.role || 'WAITER';
    const setupCompleted = role === 'ADMIN' || role === 'OWNER';

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId,
          email: data.email.toLowerCase(),
          name: data.name.trim(),
          passwordHash,
          role,
          pin: pinHash,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
      if (setupCompleted) {
        await tx.user.updateMany({
          where: { tenantId, email: BOOTSTRAP_EMAIL },
          data: { isActive: false },
        });
      }
      return created;
    });

    logger.info(`Staff created: ${user.email} (${user.role}) in tenant ${tenantId}`);
    return { ...user, setupCompleted };
  },

  async update(tenantId: string, userId: string, data: {
    name?: string;
    email?: string;
    password?: string;
    role?: StaffRole;
    pin?: string;
    isActive?: boolean;
  }) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email.toLowerCase();
    if (data.role) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, sharedEnv.BCRYPT_SALT_ROUNDS);
    }
    if (data.pin !== undefined) {
      updateData.pin = data.pin === '' ? null : await bcrypt.hash(data.pin.trim(), sharedEnv.BCRYPT_SALT_ROUNDS);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { id: userId, tenantId, email: { not: BOOTSTRAP_EMAIL } },
      });
      if (!existing) {
        throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
      }
      if (
        existing.isActive
        && (existing.role === 'OWNER' || existing.role === 'ADMIN')
        && ((data.role && data.role !== 'OWNER' && data.role !== 'ADMIN') || data.isActive === false)
      ) {
        await assertManagerWillRemain(tx, tenantId, userId);
      }
      return tx.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    logger.info(`Staff updated: ${updated.email} in tenant ${tenantId}`);
    return updated;
  },

  async remove(tenantId: string, userId: string) {
    const existing = await prisma.$transaction(async (tx) => {
      const found = await tx.user.findFirst({
        where: { id: userId, tenantId, email: { not: BOOTSTRAP_EMAIL } },
      });
      if (!found) {
        throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
      }
      if (found.isActive && (found.role === 'OWNER' || found.role === 'ADMIN')) {
        await assertManagerWillRemain(tx, tenantId, userId);
      }
      // Soft-delete: siparis gecmisini korumak icin fiziksel silme yapilmaz.
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false },
      });
      return found;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    logger.info(`Staff deactivated: ${existing.email} in tenant ${tenantId}`);
    return { success: true };
  },
};
