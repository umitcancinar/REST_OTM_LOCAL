// ==========================================
// Staff Service — Business Logic
// ==========================================

import bcrypt from 'bcryptjs';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export const staffService = {
  async findAll(tenantId: string) {
    return prisma.user.findMany({
      where: { tenantId, role: { in: ['WAITER', 'CHEF', 'CASHIER', 'ADMIN', 'OWNER'] }, isActive: true },
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
    role?: string;
    pin?: string;
  }) {
    // Check email uniqueness within tenant
    const existing = await prisma.user.findFirst({
      where: { tenantId, email: data.email.toLowerCase() },
    });
    if (existing) {
      throw Object.assign(new Error('Bu e-posta adresi zaten kullanılıyor.'), { statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const pinHash = data.pin ? await bcrypt.hash(data.pin.trim(), 10) : undefined;

    const role = (data.role as any) || 'WAITER';

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: data.email.toLowerCase(),
        name: data.name,
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

    logger.info(`Staff created: ${user.email} (${user.role}) in tenant ${tenantId}`);
    return user;
  },

  async update(tenantId: string, userId: string, data: {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    pin?: string;
    isActive?: boolean;
  }) {
    const existing = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!existing) {
      throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
    }

    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email.toLowerCase();
    if (data.role) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }
    if (data.pin !== undefined) {
      updateData.pin = data.pin === '' ? null : await bcrypt.hash(data.pin.trim(), 10);
    }

    const updated = await prisma.user.update({
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

    logger.info(`Staff updated: ${updated.email} in tenant ${tenantId}`);
    return updated;
  },

  async remove(tenantId: string, userId: string) {
    const existing = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!existing) {
      throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
    }

    // Soft-delete: deactivate instead of hard delete to preserve order history
    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    logger.info(`Staff deactivated: ${existing.email} in tenant ${tenantId}`);
    return { success: true };
  },
};
