import { Application } from 'express';
import bcrypt from 'bcryptjs';
import { cloudEnv } from '../config/env.cloud';
import prisma from '../config/database';
import { publicCmsLimiter } from '../middlewares/rateLimiter.middleware';
import authRoutes from '../modules/auth/auth.routes';
import cloudMenuSyncRoutes from '../modules/cloud-menu-sync/cloud-menu-sync.routes';
import licenseAdminRoutes from '../modules/license-admin/license-admin.routes';
import licenseRoutes from '../modules/license/license.routes';
import publicRoutes from '../modules/public/public.routes';
import tenantRoutes from '../modules/tenants/tenant.routes';
import { logger } from '../utils/logger';
import { RuntimeLifecycle } from './base.runtime';

async function ensureAdminUser(retries = 3, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const desiredPassword = cloudEnv.SUPER_ADMIN_PASSWORD;
      const desiredEmail = cloudEnv.SUPER_ADMIN_EMAIL;
      if (!desiredPassword || desiredPassword === 'dev-super-admin-CHANGE-ME') {
        logger.warn('SUPER_ADMIN_PASSWORD ayarlanmamis; superadmin guncellenmedi.');
        return;
      }

      let superAdmin = await prisma.user.findFirst({
        where: { email: { equals: desiredEmail, mode: 'insensitive' } },
      });
      if (!superAdmin) {
        superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      }

      if (!superAdmin) {
        await prisma.user.create({
          data: {
            email: desiredEmail,
            passwordHash: await bcrypt.hash(desiredPassword, 12),
            name: 'Süper Admin',
            role: 'SUPER_ADMIN',
            isActive: true,
          },
        });
        logger.success(`SUPER_ADMIN olusturuldu: ${desiredEmail}`);
        return;
      }

      const updateData: { email?: string; passwordHash?: string; isActive?: boolean } = {};
      if (!superAdmin.isActive) updateData.isActive = true;
      if (superAdmin.email.toLowerCase() !== desiredEmail.toLowerCase()) {
        updateData.email = desiredEmail;
      }
      if (!await bcrypt.compare(desiredPassword, superAdmin.passwordHash)) {
        updateData.passwordHash = await bcrypt.hash(desiredPassword, 12);
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({ where: { id: superAdmin.id }, data: updateData });
      }
      return;
    } catch (error) {
      logger.error(`ensureAdminUser hatasi (${attempt}/${retries}):`, error);
      if (attempt === retries) return;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function registerCloudProfile(
  app: Application,
  options: { includeAuth?: boolean } = {},
): RuntimeLifecycle {
  if (options.includeAuth !== false) app.use('/api/auth', authRoutes);
  app.use('/api/public', publicCmsLimiter, publicRoutes);
  app.use('/api/license', licenseRoutes);
  app.use('/api/license-admin', licenseAdminRoutes);
  app.use('/api/cloud-sync/v1', cloudMenuSyncRoutes);
  app.use('/api/tenants', tenantRoutes);

  return { beforeStart: ensureAdminUser };
}
