// ==========================================
// Auth Routes
// ==========================================

import { Router } from 'express';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { authLimiter } from '../../middlewares/rateLimiter.middleware';
import { rbac } from '../../middlewares/rbac.middleware';

const router = Router();

// Public routes (rate-limited)
router.post('/login', authLimiter, authController.login);
router.post('/pin-login', authLimiter, authController.pinLogin);
router.post('/refresh', authLimiter, authController.refreshToken);  // Rate-limited to prevent brute-force
// Cikis bilerek authMiddleware'siz: suresi dolmus bir access token'la da
// oturum kapatilabilmeli. Yetki, gonderilen refresh token'in kendisidir.
router.post('/logout', authController.logout);

// Protected routes
// GUVENLIK: tenantMiddleware sart — register artik hedef tenant'i istekten
// degil, req.user.tenantId'den (SUPER_ADMIN icin x-tenant-id header
// override'iyla) belirliyor. Bkz. auth.controller.ts register().
router.post('/register', authMiddleware, tenantMiddleware, rbac('OWNER', 'SUPER_ADMIN'), authController.register);
router.post('/verify-pin', authMiddleware, authController.verifyPin);
router.post('/change-password', authMiddleware, authController.changePassword);
router.post('/admin/reset-password', authMiddleware, rbac('SUPER_ADMIN', 'OWNER'), authController.adminResetPassword);
router.get('/profile', authMiddleware, authController.getProfile);

export default router;
