// ==========================================
// Inventory Routes
// ==========================================

import { Router } from 'express';
import { inventoryController } from './inventory.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

// Inventory Items
router.get('/', inventoryController.getAll);
router.get('/alerts', inventoryController.getStockAlerts);
router.get('/:id', inventoryController.getById);
router.post('/', minRole('CHEF'), inventoryController.create);
router.patch('/:id', minRole('CHEF'), inventoryController.update);
router.delete('/:id', minRole('OWNER'), inventoryController.delete);

// Recipes
router.get('/recipes/:menuItemId', inventoryController.getRecipe);
router.post('/recipes', minRole('CHEF'), inventoryController.createRecipe);

// Waste Logs
router.get('/waste', inventoryController.getWasteLogs);
router.post('/waste', minRole('CASHIER'), inventoryController.createWasteLog);

export default router;
