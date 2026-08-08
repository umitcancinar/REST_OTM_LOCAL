"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const order_controller_1 = require("./order.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rateLimiter_middleware_1 = require("../../middlewares/rateLimiter.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.get('/', order_controller_1.orderController.getAll);
router.get('/active/:tableId', order_controller_1.orderController.getActiveOrderByTable);
router.get('/:id', order_controller_1.orderController.getById);
router.post('/', rateLimiter_middleware_1.orderLimiter, order_controller_1.orderController.create);
router.patch('/:id/status', order_controller_1.orderController.updateStatus);
router.patch('/:id/hide', order_controller_1.orderController.hideOrder);
router.patch('/:orderId/items/:itemId/status', order_controller_1.orderController.updateItemStatus);
router.patch('/:orderId/items/:itemId/quantity', order_controller_1.orderController.updateItemQuantity);
router.post('/:id/print-bill', order_controller_1.orderController.printBill);
router.post('/:id/transfer', order_controller_1.orderController.transferTable);
router.delete('/', (0, rbac_middleware_1.minRole)('CASHIER'), order_controller_1.orderController.bulkDelete); // CASHIER+ only
router.delete('/:id', (0, rbac_middleware_1.minRole)('CASHIER'), order_controller_1.orderController.delete);
exports.default = router;
//# sourceMappingURL=order.routes.js.map