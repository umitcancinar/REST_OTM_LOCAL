"use strict";
// ==========================================
// Lisans Servisi — BULUT tarafi
// ==========================================
// Lisansi burasi URETIR ve DENETLER. Ozel anahtar yalnizca bu surecin
// ortam degiskeninde bulunur; musteriye giden pakette yer almaz.
//
// Iki genel uc nokta var ve ikisi de kimlik dogrulamasi ISTEMEZ —
// musterinin bilgisayari henuz kimse olarak giris yapmis degil, elinde
// sadece lisans anahtari var. Kimlik dogrulamasinin yerini anahtarin
// kendisi ve donanim baglamasi tutuyor. Bu yuzden ikisi de siki sekilde
// hiz sinirlanmali (bkz. license.routes.ts).
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseService = exports.HEARTBEAT_INTERVAL_HOURS = void 0;
const sign_1 = require("@rest-otm/license/sign");
const database_1 = __importDefault(require("../../config/database"));
const env_1 = require("../../config/env");
const logger_1 = require("../../utils/logger");
/** Yoklama araligi: lokal taraf bu siklikta baglanir. */
exports.HEARTBEAT_INTERVAL_HOURS = 1;
/** Supheli bir olayi kaydeder. Superadmin panelinde gorunur. */
async function flagSuspicious(licenseId, reason) {
    await database_1.default.license.update({
        where: { id: licenseId },
        data: {
            suspiciousCount: { increment: 1 },
            lastSuspiciousAt: new Date(),
        },
    });
    logger_1.logger.warn(`Lisans supheli olay [${licenseId}]: ${reason}`);
}
/** Imzalanmis lisansi uretir. Sure her seferinde DB'den okunur —
 *  superadmin sureyi uzattiginda bir sonraki yoklamada otomatik yansir. */
function sign(license) {
    if (!env_1.env.LICENSE_PRIVATE_KEY) {
        throw Object.assign(new Error('Lisans sunucusu yapılandırılmamış.'), { statusCode: 503 });
    }
    return (0, sign_1.issueLicense)({
        licenseKey: license.key,
        tenantId: license.tenantId,
        restaurantName: license.tenant.name,
        hardwareId: license.hardwareId,
        expiresAt: license.expiresAt,
        graceDays: license.graceDays,
        features: license.features,
    }, env_1.env.LICENSE_PRIVATE_KEY);
}
exports.licenseService = {
    /**
     * Aktivasyon — musterinin bilgisayarina ILK kurulumda cagrilir.
     * Lisansi o makineye baglar ve imzali lisansi dondurur.
     */
    async activate(input) {
        const license = await database_1.default.license.findUnique({
            where: { key: input.licenseKey.trim().toUpperCase() },
            include: { tenant: { select: { name: true, isActive: true } } },
        });
        // Bilinmeyen anahtar ile "baska makineye bagli" ayni mesaji dondurur:
        // saldirgan hangi anahtarlarin var oldugunu deneyerek ogrenemesin.
        if (!license) {
            throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
        }
        if (license.status === 'REVOKED') {
            throw Object.assign(new Error('Bu lisans iptal edilmiş. Lütfen bizimle iletişime geçin.'), {
                statusCode: 403,
            });
        }
        if (license.status === 'SUSPENDED') {
            throw Object.assign(new Error('Lisansınız askıya alınmış. Lütfen bizimle iletişime geçin.'), {
                statusCode: 403,
            });
        }
        if (!license.tenant.isActive) {
            throw Object.assign(new Error('Restoran hesabı aktif değil.'), { statusCode: 403 });
        }
        // Zaten BASKA bir makineye bagliysa reddet. Ayni makineden tekrar
        // aktivasyon (yeniden kurulum) ise sorunsuz devam eder.
        if (license.hardwareId && license.hardwareId !== input.hardwareId) {
            await flagSuspicious(license.id, 'farkli donanimdan aktivasyon denemesi');
            throw Object.assign(new Error('Bu lisans başka bir bilgisayarda kullanımda. Cihaz değişikliği için bizimle iletişime geçin.'), { statusCode: 409 });
        }
        if (license.expiresAt < new Date()) {
            throw Object.assign(new Error('Üyelik süreniz dolmuş. Lütfen süre uzatın.'), { statusCode: 402 });
        }
        const updated = await database_1.default.license.update({
            where: { id: license.id },
            data: {
                status: 'ACTIVE',
                hardwareId: input.hardwareId,
                hardwareIdShort: input.hardwareIdShort ?? null,
                activatedAt: license.activatedAt ?? new Date(),
                lastHeartbeatAt: new Date(),
                lastHeartbeatIp: input.ip ?? null,
                appVersion: input.appVersion ?? null,
            },
            include: { tenant: { select: { name: true } } },
        });
        logger_1.logger.info(`Lisans aktive edildi: ${updated.key} -> ${updated.tenant.name}`);
        return {
            license: sign({ ...updated, hardwareId: input.hardwareId }),
            serverTime: new Date().toISOString(),
            heartbeatIntervalHours: exports.HEARTBEAT_INTERVAL_HOURS,
        };
    },
    /**
     * Yoklama — lokal taraf saatte bir cagirir.
     *
     * Her yoklamada YENIDEN imzalanmis lisans doner. Boylece superadmin
     * sureyi uzattiginda musterinin hicbir sey yapmasina gerek kalmaz;
     * en gec bir saat icinde yeni sure kendiliginden gecerli olur.
     */
    async heartbeat(input) {
        const license = await database_1.default.license.findUnique({
            where: { key: input.licenseKey.trim().toUpperCase() },
            include: { tenant: { select: { name: true, isActive: true } } },
        });
        if (!license) {
            throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
        }
        // Baglanmis donanimdan farkli bir makine yokluyorsa: lisans dosyasi
        // kopyalanmis olabilir. Reddet ve isaretle.
        if (license.hardwareId && license.hardwareId !== input.hardwareId) {
            await flagSuspicious(license.id, 'farkli donanimdan yoklama');
            throw Object.assign(new Error('Lisans bu cihaza tanımlı değil.'), { statusCode: 409 });
        }
        if (license.status === 'REVOKED' || license.status === 'SUSPENDED' || !license.tenant.isActive) {
            // Kaydi yine de guncelle: sistemin ayakta oldugunu bilmek isteriz.
            await database_1.default.license.update({
                where: { id: license.id },
                data: { lastHeartbeatAt: new Date(), lastHeartbeatIp: input.ip ?? null },
            });
            throw Object.assign(new Error('Lisansınız aktif değil. Lütfen bizimle iletişime geçin.'), {
                statusCode: 403,
            });
        }
        const updated = await database_1.default.license.update({
            where: { id: license.id },
            data: {
                lastHeartbeatAt: new Date(),
                lastHeartbeatIp: input.ip ?? null,
                appVersion: input.appVersion ?? license.appVersion,
            },
            include: { tenant: { select: { name: true } } },
        });
        return {
            license: sign({ ...updated, hardwareId: input.hardwareId }),
            serverTime: new Date().toISOString(),
            heartbeatIntervalHours: exports.HEARTBEAT_INTERVAL_HOURS,
        };
    },
};
//# sourceMappingURL=license.service.js.map