"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const customer_controller_1 = require("./customer.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.get('/', customer_controller_1.customerController.getAll);
router.get('/:id', customer_controller_1.customerController.getById);
router.post('/', customer_controller_1.customerController.create);
router.patch('/:id', (0, rbac_middleware_1.minRole)('CASHIER'), customer_controller_1.customerController.update);
router.delete('/', (0, rbac_middleware_1.minRole)('OWNER'), customer_controller_1.customerController.bulkDelete);
router.delete('/:id', (0, rbac_middleware_1.minRole)('OWNER'), customer_controller_1.customerController.delete);
exports.default = router;
//# sourceMappingURL=customer.routes.js.map