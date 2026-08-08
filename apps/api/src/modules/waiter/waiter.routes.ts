// ==========================================
// Waiter Routes
// ==========================================

import { Router } from 'express';
import { waiterController } from './waiter.controller';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';

const router = Router();

// Menu uygulaması müşteri tarafında olduğu için Auth gerekmez, sadece TenantID (Restoran) kontrolü gereklidir.
router.use(tenantMiddleware);

router.post('/call', waiterController.callWaiter);

export default router;
