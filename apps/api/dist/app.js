"use strict";
// ==========================================
// Express Application Bootstrap
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const http_1 = require("http");
const env_1 = require("./config/env");
const logger_1 = require("./utils/logger");
const errorHandler_middleware_1 = require("./middlewares/errorHandler.middleware");
const rateLimiter_middleware_1 = require("./middlewares/rateLimiter.middleware");
const socket_server_1 = require("./websocket/socket.server");
const cleanup_task_1 = require("./modules/orders/cleanup.task");
const database_1 = __importDefault(require("./config/database"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// ─── Startup Tasks ───────────────────────────
async function ensureAdminUser(retries = 3, delayMs = 3000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const desiredPassword = env_1.env.SUPER_ADMIN_PASSWORD;
            const desiredEmail = env_1.env.SUPER_ADMIN_EMAIL;
            if (!desiredPassword || desiredPassword === 'dev-super-admin-CHANGE-ME') {
                logger_1.logger.warn('SUPER_ADMIN_PASSWORD env değişkeni ayarlanmamış — superadmin şifresi güncellenmedi.');
                return;
            }
            // E-posta ile ara (en güvenilir yöntem)
            let superAdmin = await database_1.default.user.findFirst({
                where: { email: { equals: desiredEmail, mode: 'insensitive' } },
            });
            if (!superAdmin) {
                // E-posta yoksa role'e göre ara
                superAdmin = await database_1.default.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
            }
            if (!superAdmin) {
                // Hiç super admin yoksa oluştur
                const newHash = await bcryptjs_1.default.hash(desiredPassword, 12);
                await database_1.default.user.create({
                    data: {
                        email: desiredEmail,
                        passwordHash: newHash,
                        name: 'Süper Admin',
                        role: 'SUPER_ADMIN',
                        isActive: true,
                    },
                });
                logger_1.logger.success(`SUPER_ADMIN oluşturuldu: ${desiredEmail}`);
                return;
            }
            const updateData = {};
            if (!superAdmin.isActive) {
                updateData.isActive = true;
                logger_1.logger.warn(`SUPER_ADMIN pasif durumdaydı, aktif edildi: ${superAdmin.email}`);
            }
            if (superAdmin.email.toLowerCase() !== desiredEmail.toLowerCase()) {
                updateData.email = desiredEmail;
                logger_1.logger.warn(`SUPER_ADMIN e-postası güncellendi: ${superAdmin.email} → ${desiredEmail}`);
            }
            const alreadyMatches = await bcryptjs_1.default.compare(desiredPassword, superAdmin.passwordHash);
            if (!alreadyMatches) {
                updateData.passwordHash = await bcryptjs_1.default.hash(desiredPassword, 12);
                logger_1.logger.success('SUPER_ADMIN şifresi env değişkenine göre güncellendi.');
            }
            if (Object.keys(updateData).length > 0) {
                await database_1.default.user.update({ where: { id: superAdmin.id }, data: updateData });
            }
            else {
                logger_1.logger.info(`SUPER_ADMIN (${superAdmin.email}) zaten güncel.`);
            }
            return; // Başarılı — loop'tan çık
        }
        catch (err) {
            logger_1.logger.error(`ensureAdminUser hatası (deneme ${attempt}/${retries}):`, err);
            if (attempt < retries) {
                logger_1.logger.warn(`${delayMs / 1000} saniye sonra tekrar denenecek...`);
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
        const tenant = await database_1.default.tenant.findFirst({ where: { slug: 'lezzet-restoran' } });
        if (!tenant)
            return;
        const current = tenant.settings || {};
        // Default CMS values from the HTML template
        const defaults = {
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
        const updates = {};
        let missingCount = 0;
        for (const [key, defaultVal] of Object.entries(defaults)) {
            if (!current[key] || current[key] === '') {
                updates[key] = defaultVal;
                missingCount++;
            }
        }
        if (missingCount > 0) {
            await database_1.default.tenant.update({
                where: { id: tenant.id },
                data: { settings: { ...current, ...updates } },
            });
            logger_1.logger.success(`Restored ${missingCount} missing CMS settings fields for "${tenant.slug}".`);
        }
    }
    catch (error) {
        logger_1.logger.error('Error restoring CMS defaults:', error);
    }
}
// Route imports
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const tenant_routes_1 = __importDefault(require("./modules/tenants/tenant.routes"));
const menu_routes_1 = __importDefault(require("./modules/menu/menu.routes"));
const table_routes_1 = __importDefault(require("./modules/tables/table.routes"));
const order_routes_1 = __importDefault(require("./modules/orders/order.routes"));
const inventory_routes_1 = __importDefault(require("./modules/inventory/inventory.routes"));
const report_routes_1 = __importDefault(require("./modules/reports/report.routes"));
const print_routes_1 = __importDefault(require("./modules/printing/print.routes"));
const reservation_routes_1 = __importDefault(require("./modules/reservations/reservation.routes"));
const public_routes_1 = __importDefault(require("./modules/public/public.routes"));
const waiter_routes_1 = __importDefault(require("./modules/waiter/waiter.routes"));
const customer_routes_1 = __importDefault(require("./modules/customers/customer.routes"));
const cms_routes_1 = __importDefault(require("./modules/cms/cms.routes"));
const pos_routes_1 = __importDefault(require("./modules/pos/pos.routes"));
const staff_routes_1 = __importDefault(require("./modules/staff/staff.routes"));
const license_routes_1 = __importDefault(require("./modules/license/license.routes"));
// ─── App Initialization ──────────────────────
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
// ─── Global Middleware ───────────────────────
app.set('trust proxy', 1); // Trust first proxy (Railway/Render/etc.)
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: env_1.env.CORS_ORIGIN, credentials: true }));
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)('short', { stream: { write: (msg) => logger_1.logger.http(msg.trim()) } }));
app.use(rateLimiter_middleware_1.generalLimiter);
// ─── Health Check ────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({
        success: true,
        message: 'REST_OTM API is running',
        version: '1.0.0',
        // Only expose environment info in non-production
        ...(env_1.env.NODE_ENV !== 'production' && { environment: env_1.env.NODE_ENV }),
        timestamp: new Date().toISOString(),
    });
});
// ─── API Routes ──────────────────────────────
app.use('/api/public', rateLimiter_middleware_1.publicCmsLimiter, public_routes_1.default);
// Lisans uc noktalari kimlik dogrulamasizdir; kendi hiz sinirlarini
// license.routes.ts icinde tasirlar (bkz. oradaki aciklama).
app.use('/api/license', license_routes_1.default);
app.use('/api/auth', auth_routes_1.default);
app.use('/api/tenants', tenant_routes_1.default);
app.use('/api/menu', menu_routes_1.default);
app.use('/api/tables', table_routes_1.default);
app.use('/api/orders', order_routes_1.default);
app.use('/api/inventory', inventory_routes_1.default);
app.use('/api/reports', report_routes_1.default);
app.use('/api/printers', print_routes_1.default);
app.use('/api/reservations', reservation_routes_1.default);
app.use('/api/waiter', waiter_routes_1.default);
app.use('/api/customers', customer_routes_1.default);
app.use('/api/cms', cms_routes_1.default);
app.use('/api/pos', pos_routes_1.default);
app.use('/api/staff', staff_routes_1.default);
// ─── 404 Handler ─────────────────────────────
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        timestamp: new Date().toISOString(),
    });
});
// ─── Global Error Handler ────────────────────
app.use(errorHandler_middleware_1.errorHandler);
// ─── Socket.io & Background Tasks ───────────
(0, socket_server_1.initializeSocketServer)(httpServer);
(0, cleanup_task_1.initCleanupTask)();
// ─── Start Server ────────────────────────────
// Uretimde yalnizca 127.0.0.1 dinlenir: API'nin onunde TLS'i sonlandiran
// bir ters vekil (nginx) durur, disaridan dogrudan erisime gerek yoktur.
// Tum arayuzleri dinlemek, guvenlik duvari bir gun yanlis yapilandirilirsa
// TLS'siz API'yi dogrudan internete acar. Gelistirmede 0.0.0.0 kalir ki
// ayni agdaki telefon/tablet ile test edilebilsin.
const HOST = env_1.env.BIND_HOST;
httpServer.listen(env_1.env.PORT, HOST, async () => {
    await ensureAdminUser();
    await restoreCmsDefaults();
    logger_1.logger.info(`CORS Allowed Origins: ${env_1.env.CORS_ORIGIN.join(', ')}`);
    logger_1.logger.success(`
  ╔══════════════════════════════════════════════╗
  ║                                              ║
  ║   🍽️  REST_OTM API Server                    ║
  ║                                              ║
  ║   Port:        ${String(env_1.env.PORT).padEnd(28)}║
  ║   Environment: ${env_1.env.NODE_ENV.padEnd(28)}║
  ║   API:         http://${HOST}:${String(env_1.env.PORT).padEnd(14)}║
  ║   WebSocket:   ws://${HOST}:${String(env_1.env.PORT).padEnd(16)}║
  ║                                              ║
  ╚══════════════════════════════════════════════╝
  `);
});
exports.default = app;
//# sourceMappingURL=app.js.map