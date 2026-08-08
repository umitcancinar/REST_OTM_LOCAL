// ==========================================
// Express Application Bootstrap
// ==========================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middlewares/errorHandler.middleware';
import { generalLimiter, publicCmsLimiter } from './middlewares/rateLimiter.middleware';
import { initializeSocketServer } from './websocket/socket.server';
import { initCleanupTask } from './modules/orders/cleanup.task';
import prisma from './config/database';
import bcrypt from 'bcryptjs';

// ─── Startup Tasks ───────────────────────────
async function ensureAdminUser(retries = 3, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const desiredPassword = env.SUPER_ADMIN_PASSWORD;
      const desiredEmail = env.SUPER_ADMIN_EMAIL;

      if (!desiredPassword || desiredPassword === 'dev-super-admin-CHANGE-ME') {
        logger.warn('SUPER_ADMIN_PASSWORD env değişkeni ayarlanmamış — superadmin şifresi güncellenmedi.');
        return;
      }

      // E-posta ile ara (en güvenilir yöntem)
      let superAdmin = await prisma.user.findFirst({
        where: { email: { equals: desiredEmail, mode: 'insensitive' } },
      });

      if (!superAdmin) {
        // E-posta yoksa role'e göre ara
        superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      }

      if (!superAdmin) {
        // Hiç super admin yoksa oluştur
        const newHash = await bcrypt.hash(desiredPassword, 12);
        await prisma.user.create({
          data: {
            email: desiredEmail,
            passwordHash: newHash,
            name: 'Süper Admin',
            role: 'SUPER_ADMIN',
            isActive: true,
          },
        });
        logger.success(`SUPER_ADMIN oluşturuldu: ${desiredEmail}`);
        return;
      }

      const updateData: Record<string, any> = {};

      if (!superAdmin.isActive) {
        updateData.isActive = true;
        logger.warn(`SUPER_ADMIN pasif durumdaydı, aktif edildi: ${superAdmin.email}`);
      }

      if (superAdmin.email.toLowerCase() !== desiredEmail.toLowerCase()) {
        updateData.email = desiredEmail;
        logger.warn(`SUPER_ADMIN e-postası güncellendi: ${superAdmin.email} → ${desiredEmail}`);
      }

      const alreadyMatches = await bcrypt.compare(desiredPassword, superAdmin.passwordHash);
      if (!alreadyMatches) {
        updateData.passwordHash = await bcrypt.hash(desiredPassword, 12);
        logger.success('SUPER_ADMIN şifresi env değişkenine göre güncellendi.');
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({ where: { id: superAdmin.id }, data: updateData });
      } else {
        logger.info(`SUPER_ADMIN (${superAdmin.email}) zaten güncel.`);
      }
      return; // Başarılı — loop'tan çık
    } catch (err) {
      logger.error(`ensureAdminUser hatası (deneme ${attempt}/${retries}):`, err);
      if (attempt < retries) {
        logger.warn(`${delayMs / 1000} saniye sonra tekrar denenecek...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}

/**
 * Restore missing CMS settings fields on startup.
 * Only fills in empty/missing fields — never overwrites existing values.
 * This fixes the issue where admin panel saves wipe out CMS fields.
 */
async function restoreCmsDefaults() {
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug: 'lezzet-restoran' } });
    if (!tenant) return;

    const current = (tenant.settings as Record<string, any>) || {};

    // Default CMS values from the HTML template
    const defaults: Record<string, any> = {
      pageTitle: 'TARİHİ ADANA KEBAPÇISI | MURAT ÖZÇELİK',
      heroSub: 'Lezzet Diyarına Hoş Geldiniz',
      heroTitle: 'Usta Ellerden Ustalık Eseri Yemekler',
      heroDesc: 'Sevilen yöresel lezzetler, usta şeflerimizin dokunuşuyla yeniden şekilleniyor. Duyularınıza hitap eden bu yolculuğa davetlisiniz.',
      heroBtn1: 'Menüyü Keşfet',
      heroBtn2: 'Masa Ayırt',
      aboutTitle: 'Tutkuyla Hazırlanan Her Tabak',
      aboutF1: '%100 Organik & Taze Ürünler',
      aboutF2: 'Ödüllü Şef Kadrosu',
      promoTitle: 'Hafta Sonuna Özel %20 İndirim',
      promoDesc: 'Aile boyu menülerde ve seçili şaraplarda geçerli muhteşem fırsatı kaçırmayın.',
      promoBtn: 'Hemen Masanı Ayırt',
      footerDesc: 'Gastronomi dünyasında kalite ve tutkunun birleştiği nokta. Her tabakta bir sanat eseri, her yudumda bir hikaye.',
      copyright: '© 2026 Tarihi Adana Kebabçısı. Tüm hakları saklıdır.',
      contactAddr: 'Abdullahpaşa Mah. Saraybosna Cad. No:80, Elazığ',
      contactPhone: '+90 554 156 38 62',
      navLinks: [
        { label: 'Ana Sayfa', href: '#hero' },
        { label: 'Hakkımızda', href: '#about' },
        { label: 'Menü', href: '#menu' },
        { label: 'Galeri', href: '#gallery' },
        { label: 'Rezervasyon', href: '#reservation' },
      ],
    };

    const updates: Record<string, any> = {};
    let missingCount = 0;

    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (!current[key] || current[key] === '') {
        updates[key] = defaultVal;
        missingCount++;
      }
    }

    if (missingCount > 0) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { settings: { ...current, ...updates } },
      });
      logger.success(`Restored ${missingCount} missing CMS settings fields for "${tenant.slug}".`);
    }
  } catch (error) {
    logger.error('Error restoring CMS defaults:', error);
  }
}

// Route imports
import authRoutes from './modules/auth/auth.routes';
import tenantRoutes from './modules/tenants/tenant.routes';
import menuRoutes from './modules/menu/menu.routes';
import tableRoutes from './modules/tables/table.routes';
import orderRoutes from './modules/orders/order.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import reportRoutes from './modules/reports/report.routes';
import printRoutes from './modules/printing/print.routes';
import reservationRoutes from './modules/reservations/reservation.routes';
import publicRoutes from './modules/public/public.routes';
import waiterRoutes from './modules/waiter/waiter.routes';
import customerRoutes from './modules/customers/customer.routes';
import cmsRoutes from './modules/cms/cms.routes';
import posRoutes from './modules/pos/pos.routes';
import staffRoutes from './modules/staff/staff.routes';
import licenseRoutes from './modules/license/license.routes';

// ─── App Initialization ──────────────────────
const app = express();
const httpServer = createServer(app);

// ─── Global Middleware ───────────────────────
app.set('trust proxy', 1); // Trust first proxy (Railway/Render/etc.)
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(generalLimiter);

// ─── Health Check ────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'REST_OTM API is running',
    version: '1.0.0',
    // Only expose environment info in non-production
    ...(env.NODE_ENV !== 'production' && { environment: env.NODE_ENV }),
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ──────────────────────────────
app.use('/api/public', publicCmsLimiter, publicRoutes);
// Lisans uc noktalari kimlik dogrulamasizdir; kendi hiz sinirlarini
// license.routes.ts icinde tasirlar (bkz. oradaki aciklama).
app.use('/api/license', licenseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/printers', printRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/waiter', waiterRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/staff', staffRoutes);

// ─── 404 Handler ─────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Error Handler ────────────────────
app.use(errorHandler);

// ─── Socket.io & Background Tasks ───────────
initializeSocketServer(httpServer);
initCleanupTask();

// ─── Start Server ────────────────────────────
// Uretimde yalnizca 127.0.0.1 dinlenir: API'nin onunde TLS'i sonlandiran
// bir ters vekil (nginx) durur, disaridan dogrudan erisime gerek yoktur.
// Tum arayuzleri dinlemek, guvenlik duvari bir gun yanlis yapilandirilirsa
// TLS'siz API'yi dogrudan internete acar. Gelistirmede 0.0.0.0 kalir ki
// ayni agdaki telefon/tablet ile test edilebilsin.
const HOST = env.BIND_HOST;

httpServer.listen(env.PORT, HOST, async () => {
  await ensureAdminUser();
  await restoreCmsDefaults();
  logger.info(`CORS Allowed Origins: ${env.CORS_ORIGIN.join(', ')}`);
  logger.success(`
  ╔══════════════════════════════════════════════╗
  ║                                              ║
  ║   🍽️  REST_OTM API Server                    ║
  ║                                              ║
  ║   Port:        ${String(env.PORT).padEnd(28)}║
  ║   Environment: ${env.NODE_ENV.padEnd(28)}║
  ║   API:         http://${HOST}:${String(env.PORT).padEnd(14)}║
  ║   WebSocket:   ws://${HOST}:${String(env.PORT).padEnd(16)}║
  ║                                              ║
  ╚══════════════════════════════════════════════╝
  `);
});

export default app;
