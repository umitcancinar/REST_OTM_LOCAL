import { Router } from 'express';
import { orderController } from './order.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { orderLimiter } from '../../middlewares/rateLimiter.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

router.get('/', orderController.getAll);
router.get('/active/:tableId', orderController.getActiveOrderByTable);
router.get('/:id', orderController.getById);
router.post('/', orderLimiter, orderController.create);
router.patch('/:id/status', orderController.updateStatus);
router.patch('/:id/hide', orderController.hideOrder);
router.patch('/:orderId/items/:itemId/status', orderController.updateItemStatus);
router.patch('/:orderId/items/:itemId/quantity', orderController.updateItemQuantity);
router.post('/:id/print-bill', orderController.printBill);
router.post('/:id/transfer', orderController.transferTable);
router.delete('/', minRole('CASHIER'), orderController.bulkDelete);  // CASHIER+ only
router.delete('/:id', minRole('CASHIER'), orderController.delete);

export default router;
