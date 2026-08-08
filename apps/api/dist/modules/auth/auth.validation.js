"use strict";
// ==========================================
// Auth Validation Schemas (Zod)
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminResetPasswordSchema = exports.changePasswordSchema = exports.refreshTokenSchema = exports.registerSchema = exports.pinLoginSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const validators_1 = require("../../utils/validators");
exports.loginSchema = zod_1.z.object({
    email: validators_1.validators.email,
    password: zod_1.z.string().min(1, 'Password is required'),
    slug: zod_1.z.string().optional(), // Added for multi-tenant disambiguation
});
exports.pinLoginSchema = zod_1.z.object({
    tenantSlug: validators_1.validators.slug,
    pin: validators_1.validators.pin,
});
// GUVENLIK: tenantId BILEREK burada yok. Once istekten (body'den) aliniyordu;
// bu, herhangi bir OWNER'in baska bir restoranin tenantId'sini vererek o
// restorana kullanici eklemesine izin veriyordu (tam izolasyon kirilmasi).
// Artik sunucu tarafinda getTenantId(req) ile belirleniyor — bkz.
// auth.controller.ts register().
exports.registerSchema = zod_1.z.object({
    email: validators_1.validators.email,
    password: validators_1.validators.password,
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters'),
    role: zod_1.z.enum(['OWNER', 'CHEF', 'CASHIER', 'WAITER']),
    pin: validators_1.validators.pin.optional(),
});
exports.refreshTokenSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1, 'Refresh token is required'),
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1, 'Current password is required'),
    newPassword: validators_1.validators.password,
});
exports.adminResetPasswordSchema = zod_1.z.object({
    targetRole: zod_1.z.enum(['OWNER', 'CHEF', 'CASHIER', 'WAITER']),
    newPassword: validators_1.validators.password,
});
//# sourceMappingURL=auth.validation.js.map