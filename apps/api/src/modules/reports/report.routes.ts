// ==========================================
// Report Routes
// ==========================================

import { Router } from 'express';
import { reportController } from './report.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(minRole('CASHIER')); // Reports accessible to CASHIER and above

router.get('/daily', reportController.getDailySummary);
router.get('/revenue', reportController.getRevenueByRange);
router.get('/departments', reportController.getDepartmentStats);

export default router;
