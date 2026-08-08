"use strict";
// ==========================================
// Auth Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rateLimiter_middleware_1 = require("../../middlewares/rateLimiter.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
// Public routes (rate-limited)
router.post('/login', rateLimiter_middleware_1.authLimiter, auth_controller_1.authController.login);
router.post('/pin-login', rateLimiter_middleware_1.authLimiter, auth_controller_1.authController.pinLogin);
router.post('/refresh', rateLimiter_middleware_1.authLimiter, auth_controller_1.authController.refreshToken); // Rate-limited to prevent brute-force
// Cikis bilerek authMiddleware'siz: suresi dolmus bir access token'la da
// oturum kapatilabilmeli. Yetki, gonderilen refresh token'in kendisidir.
router.post('/logout', auth_controller_1.authController.logout);
// Protected routes
// GUVENLIK: tenantMiddleware sart — register artik hedef tenant'i istekten
// degil, req.user.tenantId'den (SUPER_ADMIN icin x-tenant-id header
// override'iyla) belirliyor. Bkz. auth.controller.ts register().
router.post('/register', auth_middleware_1.authMiddleware, tenant_middleware_1.tenantMiddleware, (0, rbac_middleware_1.rbac)('OWNER', 'SUPER_ADMIN'), auth_controller_1.authController.register);
router.post('/verify-pin', auth_middleware_1.authMiddleware, auth_controller_1.authController.verifyPin);
router.post('/change-password', auth_middleware_1.authMiddleware, auth_controller_1.authController.changePassword);
router.post('/admin/reset-password', auth_middleware_1.authMiddleware, (0, rbac_middleware_1.rbac)('SUPER_ADMIN', 'OWNER'), auth_controller_1.authController.adminResetPassword);
router.get('/profile', auth_middleware_1.authMiddleware, auth_controller_1.authController.getProfile);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map