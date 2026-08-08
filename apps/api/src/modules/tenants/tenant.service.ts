// ==========================================
// Tenant Service
// ==========================================

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { sharedEnv } from '../../config/env.shared';
import { addMonthsToExpiry } from '../../utils/subscription';

export const tenantService = {
  async findAll() {
    return prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        // BUG DUZELTMESI: customDomain daha once secilmiyordu; superadmin
        // listesi tenant.customDomain'i gosterse de veri hic gelmedigi
        // icin her satirda "-" basiyordu.
        customDomain: true,
        logo: true,
        phone: true,
        isActive: true,
        subscriptionExpiresAt: true,
        createdAt: true,
        _count: { select: { users: true, orders: true } },
      },
    });
  },

  async findById(id: string) {
    return prisma.tenant.findUnique({ where: { id } });
  },

  async findBySlug(slug: string) {
    return prisma.tenant.findUnique({ where: { slug } });
  },

  async create(data: { name: string; slug: string; address?: string; phone?: string; email?: string; adminEmail?: string; adminPassword?: string }) {
    const { adminEmail, adminPassword, ...tenantData } = data;
    // Tenant basina ayri print-agent sirri (bkz. websocket/socket.server.ts).
    // Tek bir global sir yerine, her restoran kendi sirriyla dogrulanir —
    // biri sizarsa/paylasilirsa sadece o restoranin odasini etkiler.
    const printAgentSecret = randomBytes(24).toString('hex');

    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { ...tenantData, printAgentSecret } });
      
      if (adminEmail && adminPassword) {
        const passwordHash = await bcrypt.hash(adminPassword, sharedEnv.BCRYPT_SALT_ROUNDS);
        await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: adminEmail,
            name: `${tenant.name} Yöneticisi`,
            role: 'OWNER',
            passwordHash,
          }
        });
        logger.info(`Owner created for tenant ${tenant.slug} (${adminEmail})`);
      }
      
      logger.info(`Tenant created: ${tenant.name} (${tenant.slug})`);
      return tenant;
    });
  },

  async update(id: string, data: any) {
    if (data.customDomain === '') {
      data.customDomain = null;
    }

    // ─── CRITICAL: Merge settings instead of replacing ───
    // Prisma replaces the entire JSON column on update.
    // If the caller sends partial settings (e.g. only printLayouts),
    // we must merge with existing settings to avoid wiping CMS fields.
    if (data.settings && typeof data.settings === 'object') {
      const existing = await prisma.tenant.findUnique({
        where: { id },
        select: { settings: true },
      });

      let currentSettings: Record<string, any> = {};
      if (typeof existing?.settings === 'string') {
        try {
          currentSettings = JSON.parse(existing.settings);
        } catch (e) {
          currentSettings = {};
        }
      } else if (existing?.settings && typeof existing.settings === 'object') {
        currentSettings = existing.settings as Record<string, any>;
      }
      
      data.settings = { ...currentSettings, ...data.settings };
    }

    const result = await prisma.tenant.update({ where: { id }, data });
    logger.info(`Tenant settings updated: ${id} (${Object.keys(data).join(', ')})`);
    return result;
  },

  async delete(id: string) {
    // Restoran ve finansal/audit gecmisi fiziksel olarak silinmez. Devre disi
    // tenant, bir sonraki imzali yoklamada tenant_disabled entitlement alir.
    return prisma.tenant.update({
      where: { id },
      data: { isActive: false },
    });
  },

  /**
   * Print-agent sirrini yeniden uretir. Sir HER ZAMAN sunucuda uretilir,
   * istemciden gelen bir deger asla kabul edilmez (update() uzerinden bu
   * alanin degistirilmesi bilerek engellendi, bkz. tenant.controller.ts
   * updateTenantSchema).
   */
  async regeneratePrintAgentSecret(id: string) {
    const printAgentSecret = randomBytes(24).toString('hex');
    const result = await prisma.tenant.update({
      where: { id },
      data: { printAgentSecret },
      select: { id: true, printAgentSecret: true },
    });
    logger.info(`Print-agent secret regenerated for tenant ${id}`);
    return result;
  },

  /**
   * Uyelik suresini uzatir/azaltir (superadmin-only, bkz. tenant.routes.ts).
   * `months` negatif verilirse azaltir. Hesap addMonthsToExpiry() (saf
   * fonksiyon, ayrica test edilir) ile yapilir.
   */
  async extendSubscription(id: string, months: number) {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { subscriptionExpiresAt: true },
    });
    if (!tenant) {
      throw Object.assign(new Error('Restoran bulunamadı.'), { statusCode: 404 });
    }

    const subscriptionExpiresAt = addMonthsToExpiry(tenant.subscriptionExpiresAt, months);
    const result = await prisma.tenant.update({
      where: { id },
      data: { subscriptionExpiresAt },
    });
    logger.info(`Tenant ${id} subscription ${months >= 0 ? 'extended' : 'reduced'} by ${months} month(s) → ${subscriptionExpiresAt.toISOString()}`);
    return result;
  },
};
