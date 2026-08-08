// ==========================================
// Staff Routes
// ==========================================

import { Router } from 'express';
import { staffController } from './staff.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', staffController.getAll);
router.post('/', minRole('ADMIN'), staffController.create);
router.patch('/:id', minRole('ADMIN'), staffController.update);
router.delete('/:id', minRole('ADMIN'), staffController.remove);

export default router;
