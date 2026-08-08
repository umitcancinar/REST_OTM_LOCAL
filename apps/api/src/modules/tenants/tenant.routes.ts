// ==========================================
// Tenant Routes
// ==========================================

import { Router } from 'express';
import { tenantController } from './tenant.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { rbac } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

// Super Admins only for global actions
router.get('/', rbac('SUPER_ADMIN'), tenantController.getAll);
router.post('/', rbac('SUPER_ADMIN'), tenantController.create);
router.delete('/:id', rbac('SUPER_ADMIN'), tenantController.delete);
// Lisans suresi yalniz /api/license-admin uzerinden yonetilir.

// Owners and Super Admins can manage a single tenant
router.get('/:id', rbac('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenantController.getById);
router.patch('/:id', rbac('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenantController.update);
// Sir HER ZAMAN sunucuda uretilir — kasitli olarak update()'ten ayri bir uc
// nokta (updateTenantSchema printAgentSecret'i hic kabul etmiyor).
router.post('/:id/regenerate-print-secret', rbac('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenantController.regeneratePrintAgentSecret);

export default router;
