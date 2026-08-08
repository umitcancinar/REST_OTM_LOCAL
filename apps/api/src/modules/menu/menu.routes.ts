// ==========================================
// Menu Routes
// ==========================================

import { Router } from 'express';
import { menuController } from './menu.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

// Categories
router.get('/categories', menuController.getCategories);
router.post('/categories', minRole('OWNER'), menuController.createCategory);
router.patch('/categories/reorder', minRole('OWNER'), menuController.reorderCategories);
router.patch('/categories/:id', minRole('OWNER'), menuController.updateCategory);
router.delete('/categories/:id', minRole('OWNER'), menuController.deleteCategory);

// Items
router.get('/items', menuController.getItems);
router.get('/items/:id', menuController.getItemById);
router.post('/items', minRole('OWNER'), menuController.createItem);
router.patch('/items/:id', minRole('OWNER'), menuController.updateItem);
router.delete('/items/:id', minRole('OWNER'), menuController.deleteItem);

export default router;
