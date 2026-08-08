"use strict";
// ==========================================
// Lisans Dogrulama Semalari (Zod)
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.heartbeatSchema = exports.activateSchema = void 0;
const zod_1 = require("zod");
/** SHA-256 ozeti: 64 karakter onaltilik. */
const hardwareId = zod_1.z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Geçersiz cihaz kimliği');
exports.activateSchema = zod_1.z.object({
    licenseKey: zod_1.z.string().min(8).max(64),
    hardwareId,
    hardwareIdShort: zod_1.z.string().max(32).optional(),
    appVersion: zod_1.z.string().max(32).optional(),
});
exports.heartbeatSchema = zod_1.z.object({
    licenseKey: zod_1.z.string().min(8).max(64),
    hardwareId,
    appVersion: zod_1.z.string().max(32).optional(),
});
//# sourceMappingURL=license.validation.js.map