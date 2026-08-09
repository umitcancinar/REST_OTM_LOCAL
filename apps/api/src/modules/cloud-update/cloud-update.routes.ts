import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { rbac } from '../../middlewares/rbac.middleware';
import { requireCurrentSuperAdmin } from '../license-admin/license-admin.authorization';
import { cloudUpdateController } from './cloud-update.controller';

export const cloudUpdateManifestRouter = Router();
cloudUpdateManifestRouter.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));
cloudUpdateManifestRouter.get('/manifest', cloudUpdateController.manifest);

const cloudUpdateAdminRouter = Router();
cloudUpdateAdminRouter.use(authMiddleware);
cloudUpdateAdminRouter.use(rbac('SUPER_ADMIN'));
cloudUpdateAdminRouter.use(requireCurrentSuperAdmin);
cloudUpdateAdminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
cloudUpdateAdminRouter.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

cloudUpdateAdminRouter.get('/', cloudUpdateController.list);
cloudUpdateAdminRouter.post('/', cloudUpdateController.create);
cloudUpdateAdminRouter.get('/:id', cloudUpdateController.detail);
cloudUpdateAdminRouter.post('/:id/publish', cloudUpdateController.publish);
cloudUpdateAdminRouter.post('/:id/revoke', cloudUpdateController.revoke);

export default cloudUpdateAdminRouter;
