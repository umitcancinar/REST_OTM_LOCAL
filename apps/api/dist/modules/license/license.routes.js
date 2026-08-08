"use strict";
// ==========================================
// Lisans Rotalari
// ==========================================
// Her iki uc nokta da KIMLIK DOGRULAMASIZ: musterinin bilgisayari henuz
// bir kullanici olarak giris yapmis degil, elinde yalnizca lisans anahtari
// var. Bu yuzden hiz sinirlamasi burada guvenlik onlemidir, konfor degil:
// anahtar denemesiyle gecerli lisans bulma girisimini engeller.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const license_controller_1 = require("./license.controller");
const router = (0, express_1.Router)();
/**
 * Aktivasyon nadiren cagrilir (kurulumda bir kez). Siki sinir, anahtar
 * tahmin etme denemelerini pratikte imkansiz kilar.
 */
const activateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.' },
});
/**
 * Yoklama saatte bir gelir. Sinir bunun uzerinde tutuluyor: yeniden
 * baslatmalar ve tekrar denemeler mesru sekilde birkac fazladan istek
 * uretebilir, mesru musteriyi kilitlemek istemeyiz.
 */
const heartbeatLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.' },
});
router.post('/activate', activateLimiter, license_controller_1.licenseController.activate);
router.post('/heartbeat', heartbeatLimiter, license_controller_1.licenseController.heartbeat);
exports.default = router;
//# sourceMappingURL=license.routes.js.map