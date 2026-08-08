import { Router } from 'express';
import { posController } from './pos.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { checkFeature } from '../../middlewares/feature.middleware';

const router = Router();

/**
 * @route   POST /api/pos/start-payment
 * @desc    Initiate a POS transaction
 * @access  Private (Staff/Admin)
 */
router.post('/start-payment', authMiddleware, tenantMiddleware, checkFeature('pos'), posController.startPayment);

export default router;
