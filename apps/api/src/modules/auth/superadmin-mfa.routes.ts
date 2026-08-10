import { Router } from 'express';
import {
  superAdminMfaStartLimiter,
  superAdminMfaVerifyLimiter,
  superAdminSessionLimiter,
} from '../../middlewares/rateLimiter.middleware';
import { superAdminServiceAuth } from '../../middlewares/superadmin-service-auth.middleware';
import { authController } from './auth.controller';
import { superAdminMfaController } from './superadmin-mfa.controller';

const router = Router();

// Bu router yalniz cloud profile'a baglanir. Boylece local musteri runtime'i
// cloud service secret'i istemez ve MFA control-plane endpoint'i acmaz.
router.post('/mfa/start', superAdminServiceAuth, superAdminMfaStartLimiter, superAdminMfaController.start);
router.post('/mfa/verify', superAdminServiceAuth, superAdminMfaVerifyLimiter, superAdminMfaController.verify);
router.post('/refresh', superAdminServiceAuth, superAdminSessionLimiter, authController.superAdminRefreshToken);

export default router;
