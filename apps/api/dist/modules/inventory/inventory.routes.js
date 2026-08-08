"use strict";
// ==========================================
// Inventory Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventory_controller_1 = require("./inventory.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
// Inventory Items
router.get('/', inventory_controller_1.inventoryController.getAll);
router.get('/alerts', inventory_controller_1.inventoryController.getStockAlerts);
router.get('/:id', inventory_controller_1.inventoryController.getById);
router.post('/', (0, rbac_middleware_1.minRole)('CHEF'), inventory_controller_1.inventoryController.create);
router.patch('/:id', (0, rbac_middleware_1.minRole)('CHEF'), inventory_controller_1.inventoryController.update);
router.delete('/:id', (0, rbac_middleware_1.minRole)('OWNER'), inventory_controller_1.inventoryController.delete);
// Recipes
router.get('/recipes/:menuItemId', inventory_controller_1.inventoryController.getRecipe);
router.post('/recipes', (0, rbac_middleware_1.minRole)('CHEF'), inventory_controller_1.inventoryController.createRecipe);
// Waste Logs
router.get('/waste', inventory_controller_1.inventoryController.getWasteLogs);
router.post('/waste', (0, rbac_middleware_1.minRole)('CASHIER'), inventory_controller_1.inventoryController.createWasteLog);
exports.default = router;
//# sourceMappingURL=inventory.routes.js.map