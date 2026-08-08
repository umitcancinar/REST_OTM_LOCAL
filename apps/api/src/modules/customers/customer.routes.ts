import { Router } from 'express';
import { customerController } from './customer.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', customerController.getAll);
router.get('/:id', customerController.getById);
router.post('/', customerController.create);
router.patch('/:id', minRole('CASHIER'), customerController.update);
router.delete('/', minRole('OWNER'), customerController.bulkDelete);
router.delete('/:id', minRole('OWNER'), customerController.delete);

export default router;
