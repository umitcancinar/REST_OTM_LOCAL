// ==========================================
// Reservation Routes
// ==========================================

import { Router } from 'express';
import { reservationController } from './reservation.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';
import { checkFeature } from '../../middlewares/feature.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(checkFeature('reservations'));

router.get('/', reservationController.getAll);
router.post('/', reservationController.create);
router.patch('/:id/status', reservationController.updateStatus);
router.delete('/', minRole('OWNER'), reservationController.bulkDelete);
router.delete('/:id', minRole('CASHIER'), reservationController.delete);

export default router;
