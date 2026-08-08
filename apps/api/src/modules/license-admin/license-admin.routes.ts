import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { rbac } from '../../middlewares/rbac.middleware';
import { licenseAdminController } from './license-admin.controller';
import { requireCurrentSuperAdmin } from './license-admin.authorization';

const router = Router();

// Defense in depth: bu router yanlışlıkla başka bir prefix'e mount edilse bile
// bütün uçlar hem geçerli JWT hem de tam SUPER_ADMIN rolü ister.
router.use(authMiddleware);
router.use(rbac('SUPER_ADMIN'));
router.use(requireCurrentSuperAdmin);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/', licenseAdminController.list);
router.post('/', licenseAdminController.create);
router.get('/:id', licenseAdminController.detail);
router.patch('/:id', licenseAdminController.update);
router.post('/:id/extend', licenseAdminController.extend);
router.post('/:id/suspend', licenseAdminController.suspend);
router.post('/:id/resume', licenseAdminController.resume);
router.post('/:id/revoke', licenseAdminController.revoke);
router.post('/:id/reset-activation', licenseAdminController.resetActivation);
router.post('/:id/rebind', licenseAdminController.rebind);

export default router;
