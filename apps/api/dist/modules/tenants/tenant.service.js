"use strict";
// ==========================================
// Tenant Service
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantService = void 0;
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = require("crypto");
const env_1 = require("../../config/env");
const subscription_1 = require("../../utils/subscription");
exports.tenantService = {
    async findAll() {
        return database_1.default.tenant.findMany({
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
    async findById(id) {
        return database_1.default.tenant.findUnique({ where: { id } });
    },
    async findBySlug(slug) {
        return database_1.default.tenant.findUnique({ where: { slug } });
    },
    async create(data) {
        const { adminEmail, adminPassword, ...tenantData } = data;
        // Tenant basina ayri print-agent sirri (bkz. websocket/socket.server.ts).
        // Tek bir global sir yerine, her restoran kendi sirriyla dogrulanir —
        // biri sizarsa/paylasilirsa sadece o restoranin odasini etkiler.
        const printAgentSecret = (0, crypto_1.randomBytes)(24).toString('hex');
        return database_1.default.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({ data: { ...tenantData, printAgentSecret } });
            if (adminEmail && adminPassword) {
                const passwordHash = await bcryptjs_1.default.hash(adminPassword, env_1.env.BCRYPT_SALT_ROUNDS);
                await tx.user.create({
                    data: {
                        tenantId: tenant.id,
                        email: adminEmail,
                        name: `${tenant.name} Yöneticisi`,
                        role: 'OWNER',
                        passwordHash,
                    }
                });
                logger_1.logger.info(`Owner created for tenant ${tenant.slug} (${adminEmail})`);
            }
            logger_1.logger.info(`Tenant created: ${tenant.name} (${tenant.slug})`);
            return tenant;
        });
    },
    async update(id, data) {
        if (data.customDomain === '') {
            data.customDomain = null;
        }
        // ─── CRITICAL: Merge settings instead of replacing ───
        // Prisma replaces the entire JSON column on update.
        // If the caller sends partial settings (e.g. only printLayouts),
        // we must merge with existing settings to avoid wiping CMS fields.
        if (data.settings && typeof data.settings === 'object') {
            const existing = await database_1.default.tenant.findUnique({
                where: { id },
                select: { settings: true },
            });
            let currentSettings = {};
            if (typeof existing?.settings === 'string') {
                try {
                    currentSettings = JSON.parse(existing.settings);
                }
                catch (e) {
                    currentSettings = {};
                }
            }
            else if (existing?.settings && typeof existing.settings === 'object') {
                currentSettings = existing.settings;
            }
            data.settings = { ...currentSettings, ...data.settings };
        }
        const result = await database_1.default.tenant.update({ where: { id }, data });
        logger_1.logger.info(`Tenant settings updated: ${id} (${Object.keys(data).join(', ')})`);
        return result;
    },
    async delete(id) {
        return database_1.default.tenant.delete({ where: { id } });
    },
    /**
     * Print-agent sirrini yeniden uretir. Sir HER ZAMAN sunucuda uretilir,
     * istemciden gelen bir deger asla kabul edilmez (update() uzerinden bu
     * alanin degistirilmesi bilerek engellendi, bkz. tenant.controller.ts
     * updateTenantSchema).
     */
    async regeneratePrintAgentSecret(id) {
        const printAgentSecret = (0, crypto_1.randomBytes)(24).toString('hex');
        const result = await database_1.default.tenant.update({
            where: { id },
            data: { printAgentSecret },
            select: { id: true, printAgentSecret: true },
        });
        logger_1.logger.info(`Print-agent secret regenerated for tenant ${id}`);
        return result;
    },
    /**
     * Uyelik suresini uzatir/azaltir (superadmin-only, bkz. tenant.routes.ts).
     * `months` negatif verilirse azaltir. Hesap addMonthsToExpiry() (saf
     * fonksiyon, ayrica test edilir) ile yapilir.
     */
    async extendSubscription(id, months) {
        const tenant = await database_1.default.tenant.findUnique({
            where: { id },
            select: { subscriptionExpiresAt: true },
        });
        if (!tenant) {
            throw Object.assign(new Error('Restoran bulunamadı.'), { statusCode: 404 });
        }
        const subscriptionExpiresAt = (0, subscription_1.addMonthsToExpiry)(tenant.subscriptionExpiresAt, months);
        const result = await database_1.default.tenant.update({
            where: { id },
            data: { subscriptionExpiresAt },
        });
        logger_1.logger.info(`Tenant ${id} subscription ${months >= 0 ? 'extended' : 'reduced'} by ${months} month(s) → ${subscriptionExpiresAt.toISOString()}`);
        return result;
    },
};
//# sourceMappingURL=tenant.service.js.map