// ==========================================
// Table Routes
// ==========================================

import { Router } from 'express';
import { tableController } from './table.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', tableController.getAll);
router.get('/:id', tableController.getById);
router.post('/', minRole('OWNER'), tableController.create);
router.patch('/:id', minRole('CASHIER'), tableController.update);
router.delete('/:id', minRole('OWNER'), tableController.delete);

export default router;
