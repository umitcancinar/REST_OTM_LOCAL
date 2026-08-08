"use strict";
// ==========================================
// Menu Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const menu_controller_1 = require("./menu.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
// Categories
router.get('/categories', menu_controller_1.menuController.getCategories);
router.post('/categories', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.createCategory);
router.patch('/categories/reorder', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.reorderCategories);
router.patch('/categories/:id', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.updateCategory);
router.delete('/categories/:id', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.deleteCategory);
// Items
router.get('/items', menu_controller_1.menuController.getItems);
router.get('/items/:id', menu_controller_1.menuController.getItemById);
router.post('/items', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.createItem);
router.patch('/items/:id', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.updateItem);
router.delete('/items/:id', (0, rbac_middleware_1.minRole)('OWNER'), menu_controller_1.menuController.deleteItem);
exports.default = router;
//# sourceMappingURL=menu.routes.js.map